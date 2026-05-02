/**
 * Sprint 2o.0 — /api/marketing/contacts compatibility shim.
 *
 * Pre-2o.0, this file wrapped storage.listContactsByOrg / getContact /
 * createContact / updateContact / softDeleteContact, all of which
 * read from the PSO `client_contacts` table. That was the HR4
 * violation the foundation sprint exists to fix: the Marketing OS
 * UIs at /marketing/contacts were reading directly from PSO.
 *
 * Step 3 flips this file to read from `marketing_prospects` via the
 * Step 2 storage methods. The URL surface (/api/marketing/contacts*)
 * is preserved as a thin compatibility shim so the in-flight UI keeps
 * functioning until Step 6 swaps the UI over to /api/marketing/prospects
 * directly. Once the UI migration in Step 6 is complete, this file
 * is deleted.
 *
 * NOTE: there is no longer an `import { ClientContact } from
 * "@shared/schema"` in this file (was line 6 pre-2o.0). The HR4 grep
 * gate in Step 7 enforces zero PSO imports under server/routes/marketing/.
 */
import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAuth, requireAdminOrManager, sanitizeErrorMessage } from "../middleware";
import { requireFeature } from "../../services/entitlements";
import {
  insertMarketingProspectSchema,
  marketingProspectLifecycleStageEnum,
} from "@shared/schema";

const flagGate: RequestHandler = requireFeature("marketing_os");

const idParam = z.string().uuid();
const optUuid = z.string().uuid().optional();

async function assertBrandOwned(brandId: string | undefined | null, orgId: string): Promise<void> {
  if (!brandId) return;
  const brand = await storage.getBrand(brandId, orgId);
  if (!brand) throw new Error("Invalid brand for this organization");
}

const createContactBody = insertMarketingProspectSchema
  .omit({ orgId: true })
  .extend({
    lifecycleStage: z.enum(marketingProspectLifecycleStageEnum.enumValues).optional(),
  });
const updateContactBody = createContactBody.partial();

const listQuery = z.object({
  brandId: optUuid,
  lifecycleStage: z.enum(marketingProspectLifecycleStageEnum.enumValues).optional(),
  search: z.string().optional(),
  includeDeleted: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function parseTagIdsQuery(raw: unknown): string[] {
  const arr = Array.isArray(raw)
    ? (raw as string[])
    : raw
      ? String(raw).split(",")
      : [];
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

function errMsg(err: unknown): string {
  return sanitizeErrorMessage(err instanceof Error ? err : new Error(String(err)));
}

export function registerContactRoutes(app: Express): void {
  // GET /api/marketing/contacts — list (now wraps marketing_prospects)
  app.get("/api/marketing/contacts", flagGate, requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const parsed = listQuery.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });
      }
      await assertBrandOwned(parsed.data.brandId, orgId);

      // Sprint 2d tagIds filter — preserved across the 5b1c shim flip.
      // Format: ?tagIds=a,b OR repeated ?tagIds=a&tagIds=b. Caps at 20.
      // Cross-brand validation requires brandId to scope against.
      const tagIdsParsed = parseTagIdsQuery(req.query.tagIds);
      let tagIds: string[] | undefined;
      if (tagIdsParsed.length > 0) {
        if (tagIdsParsed.length > 20) {
          return res.status(400).json({ message: "tagIds exceeds cap of 20" });
        }
        const idSchema = z.array(z.string().uuid()).max(20);
        const idCheck = idSchema.safeParse(tagIdsParsed);
        if (!idCheck.success) {
          return res.status(400).json({ message: "tagIds must be UUID strings" });
        }
        tagIds = idCheck.data;
        if (!parsed.data.brandId) {
          return res.status(400).json({ message: "brandId is required when filtering by tagIds" });
        }
        const invalid = await storage.findInvalidTagIds(orgId, parsed.data.brandId, tagIds);
        if (invalid.length > 0) {
          return res.status(400).json({
            message: "Invalid tagIds for this brand",
            invalidTagIds: invalid,
          });
        }
      }

      // Replaces the pre-2o.0 storage.listContactsByOrg(...) call that
      // read from client_contacts.
      const rows = await storage.listProspectsByOrg(orgId, { ...parsed.data, tagIds });
      return res.json(rows);
    } catch (err) {
      return res.status(500).json({ message: errMsg(err) });
    }
  });

  // GET /api/marketing/contacts/:id
  app.get("/api/marketing/contacts/:id", flagGate, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = idParam.parse(req.params.id);
      const row = await storage.getProspect(id, req.session.orgId!);
      if (!row) return res.status(404).json({ message: "Contact not found" });
      return res.json(row);
    } catch (err) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // POST /api/marketing/contacts — create
  app.post("/api/marketing/contacts", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const body = createContactBody.parse(req.body);
      await assertBrandOwned(body.brandId, orgId);
      const created = await storage.createProspect({ ...body, orgId });
      return res.status(201).json(created);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res.status(409).json({ message: "A contact with this email already exists" });
      }
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // PATCH /api/marketing/contacts/:id — update
  app.patch("/api/marketing/contacts/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const id = idParam.parse(req.params.id);
      const body = updateContactBody.parse(req.body);
      if (body.brandId) await assertBrandOwned(body.brandId, orgId);
      const updated = await storage.updateProspect(id, orgId, body);
      if (!updated) return res.status(404).json({ message: "Contact not found" });
      return res.json(updated);
    } catch (err) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // DELETE /api/marketing/contacts/:id — soft delete
  app.delete("/api/marketing/contacts/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const id = idParam.parse(req.params.id);
      const row = await storage.softDeleteProspect(id, req.session.orgId!);
      if (!row) return res.status(404).json({ message: "Contact not found" });
      return res.json({ ok: true, contact: row });
    } catch (err) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // POST /api/marketing/contacts/:id/unsubscribe — self-service unsubscribe
  app.post("/api/marketing/contacts/:id/unsubscribe", flagGate, requireAuth, async (req: Request, res: Response) => {
    try {
      const id = idParam.parse(req.params.id);
      const updated = await storage.updateProspect(id, req.session.orgId!, {
        unsubscribedAt: new Date(),
      } as any);
      if (!updated) return res.status(404).json({ message: "Contact not found" });
      return res.json({ ok: true, contact: updated });
    } catch (err) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });
}
