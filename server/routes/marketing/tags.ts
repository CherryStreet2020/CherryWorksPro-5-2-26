import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAuth, requireAdminOrManager, sanitizeErrorMessage } from "../middleware";
import { requireFeature } from "../../services/entitlements";
import { paramId } from "../../lib/req-params";
import { insertContactTagSchema } from "@shared/schema";

// Sprint 2i.2: entitlement gate replaces the env-flag gate.
const flagGate: RequestHandler = requireFeature("marketing_os");

async function assertBrandOwned(brandId: string, orgId: string): Promise<void> {
  const brand = await storage.getBrand(brandId, orgId);
  if (!brand) throw new Error("Invalid brand for this organization");
}

const HEX6 = /^#[0-9A-Fa-f]{6}$/;

// Sprint 2d: derive create/update from the shared insert schema instead of an
// inline z.object literal (fix-on-touch). orgId comes from the session, not
// the request body.
const createTagBody = insertContactTagSchema.omit({ orgId: true }).extend({
  name:  z.string().min(1).max(64),
  color: z.string().regex(HEX6).optional(),
});

const updateTagBody = insertContactTagSchema
  .omit({ orgId: true, brandId: true })
  .partial()
  .extend({
    name:  z.string().min(1).max(64).optional(),
    color: z.string().regex(HEX6).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "patch must include at least one field" });

const setContactTagsBody = z.object({
  tagIds: z.array(z.string().uuid()).max(50),
});

// Sprint 2d bulk-tag caps (mirrored in PROOF.md).
const BULK_MAX_PROSPECTS = 200;
const BULK_MAX_TAGS = 20;
// Sprint 2f (R4): bulk emission cap. The activity-row INSERT is one row
// per (contact, tag) pair; over-cap returns 400 BEFORE any work begins so
// no partial commits land. 200×20 = 4000 (the existing per-axis caps), so
// the pair cap is the binding constraint for non-trivial bulk requests.
const BULK_MAX_PAIRS = 1000;

const bulkTagBody = z.object({
  prospectIds: z.array(z.string().uuid()).max(BULK_MAX_PROSPECTS),
  tagIds:      z.array(z.string().uuid()).max(BULK_MAX_TAGS),
  brandId:     z.string().uuid().optional(),
  op:          z.enum(["assign", "unassign"]),
});

const singleAddBody = z.object({
  tagId: z.string().uuid(),
});

function errMsg(err: unknown): string {
  return sanitizeErrorMessage(err instanceof Error ? err : new Error(String(err)));
}

function isUniqueViolation(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /duplicate key|unique/i.test(m);
}

export function registerContactTagRoutes(app: Express) {
  // Sprint 2d: returns rows enriched with `contactCount` and `lastUsedAt`
  // computed on read (no schema change). The /marketing/tags page consumes
  // these; the contacts/import TagPicker treats the extra fields as harmless
  // extras.
  app.get("/api/marketing/tags", flagGate, requireAuth, async (req: Request, res: Response) => {
    try {
      const brandId = z.string().uuid().parse(req.query.brandId);
      const rows = await storage.listTagsByBrandWithCounts(req.session.orgId!, brandId);
      return res.json(rows);
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  app.post("/api/marketing/tags", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const parsed = createTagBody.parse(req.body);
      await assertBrandOwned(parsed.brandId, req.session.orgId!);
      const created = await storage.createTag({ ...parsed, orgId: req.session.orgId! });
      return res.status(201).json(created);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ message: "A tag with that name already exists for this brand" });
      }
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  app.patch("/api/marketing/tags/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const parsed = updateTagBody.parse(req.body);
      const updated = await storage.updateTag(id, req.session.orgId!, parsed);
      if (!updated) return res.status(404).json({ message: "Tag not found" });
      return res.json(updated);
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        return res.status(409).json({ message: "A tag with that name already exists for this brand" });
      }
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  app.delete("/api/marketing/tags/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const ok = await storage.deleteTag(id, req.session.orgId!);
      if (!ok) return res.status(404).json({ message: "Tag not found" });
      return res.json({ ok: true });
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // ── Per-prospect tag mutations ─────────────────────────────────────
  // Sprint 2o.0 5b1c: canonical surface is /prospects/:prospectId/tags.
  // The legacy /contacts/:id/tags URLs are kept as 5b3-removable aliases
  // (frontend has already flipped; aliases are pure rollback safety net).

  // Full-replace handler. Used by /marketing/contacts/import.
  const setTagsHandler = async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const parsed = setContactTagsBody.parse(req.body);
      const tags = await storage.setContactTags(req.session.orgId!, id, parsed.tagIds);
      return res.json({ tags });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "Contact not found") return res.status(404).json({ message: msg });
      if (msg === "Invalid tag id(s)") return res.status(400).json({ message: msg });
      return res.status(400).json({ message: errMsg(err) });
    }
  };
  app.put("/api/marketing/prospects/:id/tags", flagGate, requireAdminOrManager, setTagsHandler);
  // 5b3-ALIAS-REMOVAL-PENDING
  app.put("/api/marketing/contacts/:id/tags", flagGate, requireAdminOrManager, setTagsHandler);

  // Single-remove handler.
  const removeTagHandler = async (req: Request, res: Response) => {
    try {
      const id = paramId(req);
      const tagId = paramId(req, "tagId");
      const orgId = req.session.orgId!;
      // Sprint 2d: enforce SAME-BRAND validation before delete.
      // Resolve prospect, then verify the tag belongs to (orgId, brandId).
      const prospect = await storage.getProspect(id, orgId);
      if (!prospect) return res.status(404).json({ message: "Prospect not found" });
      if (!prospect.brandId) {
        return res.status(400).json({ message: "Prospect is not assigned to a brand" });
      }
      const invalid = await storage.findInvalidTagIds(orgId, prospect.brandId, [tagId]);
      if (invalid.length > 0) {
        return res.status(400).json({
          message: "Cross-brand or unknown tag id",
          invalidTagIds: invalid,
        });
      }
      const ok = await storage.removeTagFromContact(orgId, id, tagId, {
        actorId: req.session.userId ?? null,
      });
      if (!ok) return res.status(404).json({ message: "Assignment not found" });
      return res.json({ ok: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "Prospect not found") return res.status(404).json({ message: msg });
      return res.status(400).json({ message: errMsg(err) });
    }
  };
  app.delete("/api/marketing/prospects/:id/tags/:tagId", flagGate, requireAdminOrManager, removeTagHandler);
  // 5b3-ALIAS-REMOVAL-PENDING
  app.delete("/api/marketing/contacts/:id/tags/:tagId", flagGate, requireAdminOrManager, removeTagHandler);

  // Single-add handler. Path param resolved via paramId(req) so the route
  // pattern can use either :prospectId (new) or :id (legacy alias).
  const addSingleTagHandler = async (req: Request, res: Response) => {
    try {
      // Read whichever named param the matched route used.
      const prospectId = (req.params as Record<string, string>).prospectId
        ?? (req.params as Record<string, string>).id;
      if (!prospectId) {
        return res.status(400).json({ message: "Missing prospect id" });
      }
      const { tagId } = singleAddBody.parse(req.body);
      const orgId = req.session.orgId!;
      try {
        const { assigned } = await storage.addSingleTagToContactAtomic(
          orgId, prospectId, tagId, { actorId: req.session.userId ?? null },
        );
        return res.json({ ok: true, assigned });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "Contact not found") return res.status(404).json({ message: "Prospect not found" });
        if (msg === "Contact is not assigned to a brand") {
          return res.status(400).json({ message: "Prospect is not assigned to a brand" });
        }
        if (msg === "Invalid tag id") {
          return res.status(400).json({
            message: "Cross-brand or unknown tag id",
            invalidTagIds: [tagId],
          });
        }
        throw e;
      }
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  };
  app.post("/api/marketing/prospects/:prospectId/tags", flagGate, requireAdminOrManager, addSingleTagHandler);
  // 5b3-ALIAS-REMOVAL-PENDING
  app.post("/api/marketing/contacts/:id/tags", flagGate, requireAdminOrManager, addSingleTagHandler);

  // Sprint 2d: bulk assign / unassign.
  // Response semantics:
  //   op "assign"   → `assigned`   = (prospectIds × tagIds) rows newly inserted,
  //                   `skipped`    = pairs that were already present (no-op).
  //   op "unassign" → `unassigned` = rows actually deleted,
  //                   `skipped`    = pairs that did not exist (no-op).
  const bulkTagHandler = async (req: Request, res: Response) => {
    try {
      const parsed = bulkTagBody.parse(req.body);
      const orgId = req.session.orgId!;

      // Hard caps — over-cap returns 400 immediately, before any read.
      if (parsed.prospectIds.length > BULK_MAX_PROSPECTS) {
        return res.status(400).json({
          message: `prospectIds exceeds cap of ${BULK_MAX_PROSPECTS}`,
        });
      }
      if (parsed.tagIds.length > BULK_MAX_TAGS) {
        return res.status(400).json({
          message: `tagIds exceeds cap of ${BULK_MAX_TAGS}`,
        });
      }

      // Empty arrays → no-op success (brandId not required).
      if (parsed.prospectIds.length === 0 || parsed.tagIds.length === 0) {
        return res.json({ assigned: 0, unassigned: 0, skipped: 0 });
      }

      // Sprint 2f (R4): enforce activity-emission pair cap BEFORE any read.
      const pairCount = parsed.prospectIds.length * parsed.tagIds.length;
      if (pairCount > BULK_MAX_PAIRS) {
        return res.status(400).json({
          message: `Bulk action exceeds ${BULK_MAX_PAIRS}-pair activity-emission cap (got ${pairCount})`,
        });
      }

      // brandId is OPTIONAL: if omitted, derive it from the prospects and
      // require they all share one brand. Any drift → 400, zero writes.
      let brandId = parsed.brandId;
      if (!brandId) {
        const derived = await storage.deriveBrandIdForProspects(orgId, parsed.prospectIds);
        if (!derived.ok) {
          return res.status(400).json({
            message: derived.reason,
            invalidProspectIds: derived.invalidContactIds,
          });
        }
        brandId = derived.brandId;
      } else {
        await assertBrandOwned(brandId, orgId);
      }

      const [invalidProspectIds, invalidTagIds] = await Promise.all([
        storage.findInvalidProspectIds(orgId, brandId, parsed.prospectIds),
        storage.findInvalidTagIds(orgId, brandId, parsed.tagIds),
      ]);
      if (invalidProspectIds.length > 0 || invalidTagIds.length > 0) {
        return res.status(400).json({
          message: "Cross-brand or unknown id(s) in bulk-tag request",
          invalidProspectIds,
          invalidTagIds,
        });
      }

      try {
        const actorId = req.session.userId ?? null;
        if (parsed.op === "assign") {
          const r = await storage.bulkAssignTagsAtomic(
            orgId, brandId, parsed.prospectIds, parsed.tagIds, { actorId },
          );
          return res.json({ assigned: r.assigned, unassigned: 0, skipped: r.skipped });
        } else {
          const r = await storage.bulkUnassignTagsAtomic(
            orgId, brandId, parsed.prospectIds, parsed.tagIds, { actorId },
          );
          return res.json({ assigned: 0, unassigned: r.unassigned, skipped: r.skipped });
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("Invalid")) {
          return res.status(400).json({ message: msg });
        }
        throw e;
      }
    } catch (err: unknown) {
      return res.status(400).json({ message: errMsg(err) });
    }
  };
  app.post("/api/marketing/prospects/bulk-tag", flagGate, requireAdminOrManager, bulkTagHandler);
  // 5b3-ALIAS-REMOVAL-PENDING
  app.post("/api/marketing/contacts/bulk-tag", flagGate, requireAdminOrManager, bulkTagHandler);
}
