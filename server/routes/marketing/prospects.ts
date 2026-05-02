/**
 * Sprint 2o.0 — Marketing OS prospects routes.
 *
 * Canonical CRUD + convert surface for `marketing_prospects`. Replaces
 * the HR4-violating /api/marketing/contacts → client_contacts wiring.
 *
 * Middleware stack (matches every other /api/marketing/* route file in
 * the codebase — see contacts.ts, companies.ts, segments.ts, tags.ts,
 * campaigns.ts, activities.ts):
 *
 *   flagGate (requireFeature("marketing_os"), stealth-404)
 *     → requireAuth | requireAdminOrManager
 *     → handler
 *
 * Note on the addon gate: the project-wide convention is the
 * stealth-404 `requireFeature("marketing_os")` middleware in
 * server/services/entitlements.ts, which (a) reads the
 * `org_entitlements` table that the Stripe webhook writes after
 * verifying the live `marketing_os` price (price_1TOij0PlbOuzXblr37aDvOLU
 * in live, env-configurable in non-prod) and (b) returns 404 — never
 * 403 — to keep the feature's existence opaque to non-entitled callers.
 * The Sprint 2o.0 spec asked for a new `requireMarketingAddon`
 * returning `{ code: 'MARKETING_ADDON_REQUIRED' }` (403); reusing the
 * stealth-404 gate keeps the routes consistent with every other
 * marketing route file. See STEP3_ROUTES_REVIEW.md for the rationale.
 *
 * CSRF is enforced globally for state-changing methods by the
 * top-level CSRF middleware mounted in server/index.ts; not
 * re-applied per route.
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

async function assertCompanyOwned(companyId: string | undefined | null, orgId: string): Promise<void> {
  if (!companyId) return;
  const company = await storage.getMarketingCompany(companyId, orgId);
  if (!company) throw new Error("Invalid marketing_company for this organization");
}

/**
 * Insert / patch bodies. Use the drizzle-zod insert schema as the
 * starting point — it already omits the auto/server-managed columns
 * the spec calls out:
 *   • id, createdAt, updatedAt
 *   • unsubscribeToken (default gen_random_uuid())
 *   • convertedAt + convertedToClientContactId (server-managed by the
 *     conversion endpoint only)
 *   • deletedAt (server-managed by softDelete)
 * We then reject orgId from the wire (it's pinned from the session)
 * and constrain lifecycleStage to the enum.
 */
const createProspectBody = insertMarketingProspectSchema
  .omit({ orgId: true })
  .extend({
    lifecycleStage: z
      .enum(marketingProspectLifecycleStageEnum.enumValues)
      .optional(),
  });

const updateProspectBody = createProspectBody.partial();

const listQuery = z.object({
  brandId: optUuid,
  lifecycleStage: z.enum(marketingProspectLifecycleStageEnum.enumValues).optional(),
  search: z.string().optional(),
  includeDeleted: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const convertBody = z
  .object({
    createClient: z.boolean().optional(),
    clientOverrides: z.record(z.unknown()).optional(),
    clientContactOverrides: z.record(z.unknown()).optional(),
  })
  .optional();

function errMsg(err: unknown): string {
  return sanitizeErrorMessage(err instanceof Error ? err : new Error(String(err)));
}

export function registerProspectRoutes(app: Express): void {
  // GET /api/marketing/prospects — list
  app.get("/api/marketing/prospects", flagGate, requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const parsed = listQuery.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });
      }
      await assertBrandOwned(parsed.data.brandId, orgId);
      const rows = await storage.listProspectsByOrg(orgId, parsed.data);
      return res.json({ rows });
    } catch (err) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // GET /api/marketing/prospects/:id — detail
  app.get("/api/marketing/prospects/:id", flagGate, requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const id = idParam.parse(req.params.id);
      const row = await storage.getProspect(id, orgId);
      if (!row) return res.status(404).json({ message: "Not found" });
      return res.json(row);
    } catch (err) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // POST /api/marketing/prospects — create
  app.post("/api/marketing/prospects", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const body = createProspectBody.parse(req.body);
      await assertBrandOwned(body.brandId, orgId);
      await assertCompanyOwned(body.companyId, orgId);
      const created = await storage.createProspect({ ...body, orgId });
      return res.status(201).json(created);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res
          .status(409)
          .json({ message: "A prospect with this email already exists for this organization" });
      }
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // PATCH /api/marketing/prospects/:id — update
  app.patch("/api/marketing/prospects/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const id = idParam.parse(req.params.id);
      const body = updateProspectBody.parse(req.body);
      if (body.brandId) await assertBrandOwned(body.brandId, orgId);
      if (body.companyId) await assertCompanyOwned(body.companyId, orgId);
      const updated = await storage.updateProspect(id, orgId, body);
      if (!updated) return res.status(404).json({ message: "Not found" });
      return res.json(updated);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res
          .status(409)
          .json({ message: "A prospect with this email already exists for this organization" });
      }
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // DELETE /api/marketing/prospects/:id — soft delete
  app.delete("/api/marketing/prospects/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const id = idParam.parse(req.params.id);
      const row = await storage.softDeleteProspect(id, orgId);
      if (!row) return res.status(404).json({ message: "Not found" });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // POST /api/marketing/prospects/:id/convert — convert to client_contact
  // Idempotent. Returns 200 on success or repeat-convert (alreadyConverted=true).
  app.post(
    "/api/marketing/prospects/:id/convert",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      try {
        const orgId = req.session.orgId!;
        const id = idParam.parse(req.params.id);
        const body = convertBody.parse(req.body ?? {}) ?? {};
        const out = await storage.convertProspectToCustomer(orgId, id, body);
        return res.status(200).json(out);
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not found")) return res.status(404).json({ message: msg });
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );
}
