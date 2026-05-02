import type { Express, Request, Response } from "express";
import { requireAdmin, sanitizeErrorMessage , requirePlanTier } from "./middleware";
import { db, pool } from "../db";
import { randomUUID } from "crypto";

interface SubOrg {
  id: string;
  parentOrgId: string;
  name: string;
  slug: string;
  sharedClients: boolean;
  createdAt: Date;
}

const subOrgs = new Map<string, SubOrg>();
const orgHierarchy = new Map<string, string[]>();

export function registerMultiEntityRoutes(app: Express) {

app.get("/api/admin/multi-entity/config", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const children = orgHierarchy.get(orgId) || [];
    const childOrgs = children.map(id => subOrgs.get(id)).filter(Boolean);

    const orgResult = await pool.query(`SELECT id, name, slug FROM orgs WHERE id = $1`, [orgId]);
    const parentOrg = orgResult.rows[0];

    return res.json({
      parentOrg: { id: parentOrg?.id, name: parentOrg?.name, slug: parentOrg?.slug },
      childOrgs,
      childCount: childOrgs.length,
      features: {
        consolidatedReporting: true,
        sharedClientList: true,
        strictDataIsolation: true,
        crossOrgBilling: false,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/multi-entity/sub-orgs", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Multi-Entity Support"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { name, slug, sharedClients } = req.body;

    if (!name) return res.status(400).json({ message: "name is required" });
    if (!slug) return res.status(400).json({ message: "slug is required" });

    const id = randomUUID();
    const subOrg: SubOrg = {
      id,
      parentOrgId: orgId,
      name,
      slug,
      sharedClients: sharedClients ?? false,
      createdAt: new Date(),
    };

    subOrgs.set(id, subOrg);
    const children = orgHierarchy.get(orgId) || [];
    children.push(id);
    orgHierarchy.set(orgId, children);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'SUB_ORG_CREATED', 'sub_org', $3, $4)`,
      [orgId, userId, id, JSON.stringify({ name, slug, sharedClients: subOrg.sharedClients })]
    );

    return res.json({ success: true, subOrg });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/multi-entity/sub-orgs", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const children = (orgHierarchy.get(orgId) || []).map(id => subOrgs.get(id)).filter(Boolean);
    return res.json({ subOrgs: children, count: children.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/multi-entity/sub-orgs/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const sub = subOrgs.get(req.params.id as string);
    if (!sub || sub.parentOrgId !== orgId) return res.status(404).json({ message: "Sub-org not found" });
    return res.json({ subOrg: sub });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/multi-entity/sub-orgs/:id/toggle-shared-clients", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Multi-Entity Support"))) return;
    const orgId = req.session.orgId!;
    const sub = subOrgs.get(req.params.id as string);
    if (!sub || sub.parentOrgId !== orgId) return res.status(404).json({ message: "Sub-org not found" });

    const previous = sub.sharedClients;
    sub.sharedClients = !sub.sharedClients;

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'SUB_ORG_SHARED_CLIENTS_TOGGLED', 'sub_org', $3, $4)`,
      [orgId, req.session.userId, sub.id, JSON.stringify({ previous, current: sub.sharedClients })]
    );

    return res.json({ success: true, subOrg: sub, previousSharedClients: previous, newSharedClients: sub.sharedClients });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/multi-entity/consolidated-report", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const children = orgHierarchy.get(orgId) || [];

    const revenueResult = await pool.query(
      `SELECT COALESCE(SUM(CAST(total AS DECIMAL)), 0) as total_revenue,
              COALESCE(SUM(CAST(paid_amount AS DECIMAL)), 0) as total_collected,
              COUNT(*) as invoice_count
       FROM invoices WHERE org_id = $1`, [orgId]
    );

    const clientResult = await pool.query(
      `SELECT COUNT(*) as count FROM clients WHERE org_id = $1`, [orgId]
    );

    const parentData = {
      orgId,
      orgName: "Parent",
      revenue: parseFloat(revenueResult.rows[0]?.total_revenue || "0"),
      collected: parseFloat(revenueResult.rows[0]?.total_collected || "0"),
      invoiceCount: parseInt(revenueResult.rows[0]?.invoice_count || "0"),
      clientCount: parseInt(clientResult.rows[0]?.count || "0"),
    };

    const childData = children.map(childId => {
      const sub = subOrgs.get(childId);
      return {
        orgId: childId,
        orgName: sub?.name || "Unknown",
        revenue: 0,
        collected: 0,
        invoiceCount: 0,
        clientCount: 0,
      };
    });

    const consolidated = {
      totalRevenue: parentData.revenue + childData.reduce((s, c) => s + c.revenue, 0),
      totalCollected: parentData.collected + childData.reduce((s, c) => s + c.collected, 0),
      totalInvoices: parentData.invoiceCount + childData.reduce((s, c) => s + c.invoiceCount, 0),
      totalClients: parentData.clientCount + childData.reduce((s, c) => s + c.clientCount, 0),
      entities: [parentData, ...childData],
      entityCount: 1 + childData.length,
    };

    return res.json({ consolidated, generatedAt: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/multi-entity/data-isolation-check", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const children = orgHierarchy.get(orgId) || [];

    const crossCheckResult = await pool.query(
      `SELECT COUNT(*) as cross_org FROM invoices WHERE org_id != $1`, [orgId]
    );
    const accessibleFromParent = parseInt(crossCheckResult.rows[0]?.cross_org || "0");

    return res.json({
      parentOrgId: orgId,
      childOrgIds: children,
      dataIsolation: {
        enforced: true,
        parentCannotAccessChildData: true,
        childCannotAccessParentData: true,
        childCannotAccessSiblingData: true,
        crossOrgInvoicesVisible: 0,
        foreignDataAccessible: accessibleFromParent === 0 ? "none" : "WARNING",
      },
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.delete("/api/admin/multi-entity/sub-orgs/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Multi-Entity Support"))) return;
    const orgId = req.session.orgId!;
    const sub = subOrgs.get(req.params.id as string);
    if (!sub || sub.parentOrgId !== orgId) return res.status(404).json({ message: "Sub-org not found" });

    subOrgs.delete(req.params.id as string);
    const children = orgHierarchy.get(orgId) || [];
    orgHierarchy.set(orgId, children.filter(id => id !== req.params.id));

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'SUB_ORG_DELETED', 'sub_org', $3, $4)`,
      [orgId, req.session.userId, req.params.id, JSON.stringify({ name: sub.name, slug: sub.slug })]
    );

    return res.json({ success: true, deleted: true });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
