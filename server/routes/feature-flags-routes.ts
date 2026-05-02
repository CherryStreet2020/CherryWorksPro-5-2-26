import type { Express, Request, Response } from "express";
import { requireAdmin, requireAuth, sanitizeErrorMessage } from "./middleware";
import { db, pool } from "../db";
import { randomUUID } from "crypto";

interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  orgId: string;
  updatedBy: string | null;
  updatedAt: Date;
  createdAt: Date;
}

const featureFlagStore = new Map<string, FeatureFlag>();

const DEFAULT_FLAGS = [
  { key: "advanced_reporting", name: "Advanced Reporting", description: "Enable advanced reporting dashboards" },
  { key: "ai_invoice_generation", name: "AI Invoice Generation", description: "Use AI to auto-generate invoice line items" },
  { key: "multi_currency", name: "Multi-Currency Support", description: "Enable multi-currency invoicing and payments" },
  { key: "time_tracking_v2", name: "Time Tracking V2", description: "New time tracking UI with timer and calendar view" },
  { key: "client_portal_v2", name: "Client Portal V2", description: "Enhanced client portal with messaging" },
  { key: "expense_ocr", name: "Expense OCR", description: "OCR receipt scanning for expense uploads" },
  { key: "project_templates", name: "Project Templates", description: "Create and apply project templates" },
  { key: "bulk_invoicing", name: "Bulk Invoicing", description: "Generate invoices in bulk for multiple clients" },
  { key: "custom_branding", name: "Custom Branding", description: "Custom logo and colors on invoices and portal" },
  { key: "webhook_v2", name: "Webhook V2", description: "Enhanced webhook delivery with batching" },
];

function ensureOrgFlags(orgId: string): void {
  for (const def of DEFAULT_FLAGS) {
    const compositeKey = `${orgId}:${def.key}`;
    if (!featureFlagStore.has(compositeKey)) {
      featureFlagStore.set(compositeKey, {
        id: randomUUID(),
        key: def.key,
        name: def.name,
        description: def.description,
        enabled: false,
        orgId,
        updatedBy: null,
        updatedAt: new Date(),
        createdAt: new Date(),
      });
    }
  }
}

export function registerFeatureFlagsRoutes(app: Express) {

app.get("/api/admin/feature-flags", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    ensureOrgFlags(orgId);
    const flags = Array.from(featureFlagStore.values()).filter(f => f.orgId === orgId);
    return res.json({
      flags,
      count: flags.length,
      enabledCount: flags.filter(f => f.enabled).length,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/feature-flags/:key/toggle", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const key = req.params.key;
    const { enabled } = req.body;

    ensureOrgFlags(orgId);
    const compositeKey = `${orgId}:${key}`;
    const flag = featureFlagStore.get(compositeKey);
    if (!flag) {
      return res.status(404).json({ message: `Feature flag '${key}' not found` });
    }

    const previousState = flag.enabled;
    flag.enabled = typeof enabled === "boolean" ? enabled : !flag.enabled;
    flag.updatedBy = userId;
    flag.updatedAt = new Date();

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'FEATURE_FLAG_TOGGLED', 'feature_flag', $3, $4)`,
      [orgId, userId, key, JSON.stringify({
        key, name: flag.name, previousState, newState: flag.enabled,
      })]
    );

    return res.json({
      success: true,
      flag,
      previousState,
      newState: flag.enabled,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/feature-flags/:key", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    ensureOrgFlags(orgId);
    const compositeKey = `${orgId}:${req.params.key}`;
    const flag = featureFlagStore.get(compositeKey);
    if (!flag) {
      return res.status(404).json({ message: `Feature flag '${req.params.key}' not found` });
    }
    return res.json({ flag });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/feature-flags/evaluate", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    ensureOrgFlags(orgId);
    const flags = Array.from(featureFlagStore.values()).filter(f => f.orgId === orgId);
    const evaluated: Record<string, boolean> = {};
    for (const f of flags) {
      evaluated[f.key] = f.enabled;
    }
    return res.json({ flags: evaluated, orgId, evaluatedAt: new Date().toISOString() });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/feature-flags/check/:key", requireAuth, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    ensureOrgFlags(orgId);
    const compositeKey = `${orgId}:${req.params.key}`;
    const flag = featureFlagStore.get(compositeKey);
    return res.json({
      key: req.params.key,
      enabled: flag?.enabled ?? false,
      exists: !!flag,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/feature-flags/bulk-toggle", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { flags: flagUpdates } = req.body;
    if (!Array.isArray(flagUpdates)) return res.status(400).json({ message: "flags array required" });

    ensureOrgFlags(orgId);
    const results: any[] = [];

    for (const update of flagUpdates) {
      const compositeKey = `${orgId}:${update.key}`;
      const flag = featureFlagStore.get(compositeKey);
      if (!flag) continue;
      const prev = flag.enabled;
      flag.enabled = update.enabled;
      flag.updatedBy = userId;
      flag.updatedAt = new Date();
      results.push({ key: update.key, previousState: prev, newState: flag.enabled });
    }

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'FEATURE_FLAGS_BULK_TOGGLED', 'feature_flag', 'bulk', $3)`,
      [orgId, userId, JSON.stringify({ updates: results })]
    );

    return res.json({ success: true, updated: results.length, results });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
