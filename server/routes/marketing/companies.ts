/**
 * Sprint 2o.0 — /api/marketing/companies routes wrap marketing_companies.
 *
 * Pre-2o.0, this file wrapped storage.listCompaniesWithCounts /
 * getCompany / createCompany / updateCompany / softDeleteCompany,
 * which all read from the PSO `companies` table. That was the HR4
 * violation the foundation sprint exists to fix.
 *
 * Step 3 flips this file to read from `marketing_companies` via the
 * Step 2 storage methods. Auto-link to the (now-removed) PSO
 * `companies` table no longer happens here — `marketing_prospects`
 * carries its own `companyId` → `marketing_companies(id)` FK. The
 * "Convert to Customer" UX is the only path that materializes a PSO
 * `clients` row, via the convertMarketingCompanyToClient helper
 * exposed at POST /api/marketing/companies/:id/convert.
 *
 * Middleware stack (matches every other /api/marketing/* route file):
 *   flagGate (requireFeature("marketing_os"), stealth-404)
 *     → requireAuth | requireAdminOrManager
 *     → handler
 */
import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAuth, requireAdminOrManager, sanitizeErrorMessage } from "../middleware";
import { requireFeature } from "../../services/entitlements";
import { normalizeDomain } from "../../lib/domains";
import { insertMarketingCompanySchema } from "@shared/schema";

const flagGate: RequestHandler = requireFeature("marketing_os");

const idParam = z.string().uuid();
const optUuid = z.string().uuid().optional();

async function assertBrandOwned(brandId: string | undefined | null, orgId: string): Promise<void> {
  if (!brandId) return;
  const brand = await storage.getBrand(brandId, orgId);
  if (!brand) throw new Error("Invalid brand for this organization");
}

const domainField = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v == null || v === "" ? null : normalizeDomain(v)))
  .refine((v) => v === null || (typeof v === "string" && v.length > 0), {
    message: "Invalid domain format",
  });

/**
 * Body schemas built off the drizzle-zod insert schema, which already
 * omits the auto/server-managed columns the spec calls out:
 *   • id, createdAt, updatedAt
 *   • convertedAt + convertedToClientId  (server-managed by the
 *     conversion endpoint only)
 *   • deletedAt (server-managed by softDelete)
 * orgId is pinned from the session, never the wire.
 */
const createCompanyBody = insertMarketingCompanySchema
  .omit({ orgId: true, domain: true })
  .extend({
    domain: domainField,
  });
const updateCompanyBody = createCompanyBody.partial();

const listQuery = z.object({
  brandId: optUuid,
  lifecycleStage: z.string().optional(),
  search: z.string().optional(),
  includeDeleted: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const convertBody = z
  .object({
    clientOverrides: z.record(z.unknown()).optional(),
  })
  .optional();

function errMsg(err: unknown): string {
  return sanitizeErrorMessage(err instanceof Error ? err : new Error(String(err)));
}

export function registerCompanyRoutes(app: Express): void {
  // GET /api/marketing/companies — list
  app.get("/api/marketing/companies", flagGate, requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const parsed = listQuery.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid query", errors: parsed.error.flatten() });
      }
      await assertBrandOwned(parsed.data.brandId, orgId);
      const rows = await storage.listMarketingCompaniesByOrg(orgId, parsed.data);
      return res.json({ rows });
    } catch (err) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // GET /api/marketing/companies/:id — detail
  app.get("/api/marketing/companies/:id", flagGate, requireAuth, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const id = idParam.parse(req.params.id);
      const row = await storage.getMarketingCompany(id, orgId);
      if (!row) return res.status(404).json({ message: "Not found" });
      return res.json(row);
    } catch (err) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // POST /api/marketing/companies — create
  app.post("/api/marketing/companies", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const body = createCompanyBody.parse(req.body);
      await assertBrandOwned(body.brandId, orgId);
      const created = await storage.createMarketingCompany({ ...body, orgId } as any);
      return res.status(201).json(created);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res
          .status(409)
          .json({ message: "A company with this domain already exists for this organization" });
      }
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // PATCH /api/marketing/companies/:id — update
  app.patch("/api/marketing/companies/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const id = idParam.parse(req.params.id);
      const body = updateCompanyBody.parse(req.body);
      if (body.brandId) await assertBrandOwned(body.brandId, orgId);
      const updated = await storage.updateMarketingCompany(id, orgId, body as any);
      if (!updated) return res.status(404).json({ message: "Not found" });
      return res.json(updated);
    } catch (err: any) {
      if (err?.code === "23505") {
        return res
          .status(409)
          .json({ message: "A company with this domain already exists for this organization" });
      }
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // DELETE /api/marketing/companies/:id — soft delete
  app.delete("/api/marketing/companies/:id", flagGate, requireAdminOrManager, async (req: Request, res: Response) => {
    try {
      const orgId = req.session.orgId!;
      const id = idParam.parse(req.params.id);
      const row = await storage.softDeleteMarketingCompany(id, orgId);
      if (!row) return res.status(404).json({ message: "Not found" });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(400).json({ message: errMsg(err) });
    }
  });

  // POST /api/marketing/companies/:id/convert — convert to PSO client
  app.post(
    "/api/marketing/companies/:id/convert",
    flagGate,
    requireAdminOrManager,
    async (req: Request, res: Response) => {
      try {
        const orgId = req.session.orgId!;
        const id = idParam.parse(req.params.id);
        const body = convertBody.parse(req.body ?? {}) ?? {};
        const out = await storage.convertMarketingCompanyToClient(orgId, id, body);
        return res.status(200).json(out);
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not found")) return res.status(404).json({ message: msg });
        return res.status(400).json({ message: errMsg(err) });
      }
    },
  );
}
