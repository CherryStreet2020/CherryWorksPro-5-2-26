import type { Express, Request, Response } from "express";
import { requireAdmin, requireAuth, sanitizeErrorMessage , requirePlanTier } from "./middleware";
import { db, pool } from "../db";
import { randomUUID } from "crypto";

interface InvoiceTheme {
  id: string;
  name: string;
  key: string;
  description: string;
  layout: {
    headerPosition: string;
    logoPlacement: string;
    colorAccent: string;
    fontFamily: string;
    tableStyle: string;
    footerStyle: string;
  };
  preview: string;
}

const BUILT_IN_THEMES: InvoiceTheme[] = [
  {
    id: "theme-modern",
    name: "Modern",
    key: "modern",
    description: "Clean, contemporary design with bold accent colors and sans-serif typography",
    layout: {
      headerPosition: "top-left",
      logoPlacement: "header-left",
      colorAccent: "#2563eb",
      fontFamily: "Inter, Helvetica, sans-serif",
      tableStyle: "borderless-striped",
      footerStyle: "minimal-bar",
    },
    preview: "/api/admin/invoice-themes/preview/modern",
  },
  {
    id: "theme-classic",
    name: "Classic",
    key: "classic",
    description: "Traditional professional layout with serif fonts and bordered tables",
    layout: {
      headerPosition: "top-center",
      logoPlacement: "header-center",
      colorAccent: "#1e3a5f",
      fontFamily: "Georgia, Times New Roman, serif",
      tableStyle: "full-border",
      footerStyle: "detailed-footer",
    },
    preview: "/api/admin/invoice-themes/preview/classic",
  },
  {
    id: "theme-minimal",
    name: "Minimal",
    key: "minimal",
    description: "Ultra-clean minimalist design with maximum whitespace and subtle accents",
    layout: {
      headerPosition: "top-left",
      logoPlacement: "header-left-small",
      colorAccent: "#64748b",
      fontFamily: "system-ui, -apple-system, sans-serif",
      tableStyle: "no-border-lines-only",
      footerStyle: "single-line",
    },
    preview: "/api/admin/invoice-themes/preview/minimal",
  },
];

const orgThemeSettings = new Map<string, { themeKey: string; brandColor: string; logoUrl: string | null; updatedAt: Date }>();

export function registerInvoiceThemesRoutes(app: Express) {

app.get("/api/admin/invoice-themes", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const settings = orgThemeSettings.get(orgId);

    return res.json({
      themes: BUILT_IN_THEMES,
      count: BUILT_IN_THEMES.length,
      currentTheme: settings?.themeKey || "modern",
      brandColor: settings?.brandColor || "#2563eb",
      logoUrl: settings?.logoUrl || null,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/invoice-themes/:key", requireAdmin, async (req: Request, res: Response) => {
  const theme = BUILT_IN_THEMES.find(t => t.key === req.params.key);
  if (!theme) return res.status(404).json({ message: "Theme not found" });
  return res.json({ theme });
});

app.post("/api/admin/invoice-themes/select", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Custom Invoice Themes"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { themeKey } = req.body;
    if (!themeKey) return res.status(400).json({ message: "themeKey is required" });

    const theme = BUILT_IN_THEMES.find(t => t.key === themeKey);
    if (!theme) return res.status(400).json({ message: `Invalid theme: ${themeKey}. Valid: ${BUILT_IN_THEMES.map(t => t.key).join(", ")}` });

    const existing = orgThemeSettings.get(orgId) || { themeKey: "modern", brandColor: "#2563eb", logoUrl: null, updatedAt: new Date() };
    const previousTheme = existing.themeKey;
    existing.themeKey = themeKey;
    existing.updatedAt = new Date();
    orgThemeSettings.set(orgId, existing);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'INVOICE_THEME_CHANGED', 'invoice_theme', $3, $4)`,
      [orgId, userId, themeKey, JSON.stringify({ previousTheme, newTheme: themeKey })]
    );

    return res.json({ success: true, theme, previousTheme, newTheme: themeKey });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/invoice-themes/brand", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Custom Invoice Themes"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { brandColor, logoUrl } = req.body;

    const existing = orgThemeSettings.get(orgId) || { themeKey: "modern", brandColor: "#2563eb", logoUrl: null, updatedAt: new Date() };
    if (brandColor) existing.brandColor = brandColor;
    if (logoUrl !== undefined) existing.logoUrl = logoUrl;
    existing.updatedAt = new Date();
    orgThemeSettings.set(orgId, existing);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'INVOICE_BRAND_UPDATED', 'invoice_theme', 'brand', $3)`,
      [orgId, userId, JSON.stringify({ brandColor: existing.brandColor, logoUrl: existing.logoUrl })]
    );

    return res.json({
      success: true,
      brandColor: existing.brandColor,
      logoUrl: existing.logoUrl,
      themeKey: existing.themeKey,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/invoice-themes/logo-upload", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Custom Invoice Themes"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;

    const logoUrl = `/uploads/logos/${orgId}-${Date.now()}.png`;
    const existing = orgThemeSettings.get(orgId) || { themeKey: "modern", brandColor: "#2563eb", logoUrl: null, updatedAt: new Date() };
    existing.logoUrl = logoUrl;
    existing.updatedAt = new Date();
    orgThemeSettings.set(orgId, existing);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'INVOICE_LOGO_UPLOADED', 'invoice_theme', 'logo', $3)`,
      [orgId, userId, JSON.stringify({ logoUrl })]
    );

    return res.json({ success: true, logoUrl });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/invoice-themes/preview/:key", requireAdmin, async (req: Request, res: Response) => {
  const theme = BUILT_IN_THEMES.find(t => t.key === req.params.key);
  if (!theme) return res.status(404).json({ message: "Theme not found" });

  const orgId = req.session.orgId!;
  const settings = orgThemeSettings.get(orgId);

  return res.json({
    theme,
    brandColor: settings?.brandColor || theme.layout.colorAccent,
    logoUrl: settings?.logoUrl || null,
    sampleInvoice: {
      number: "INV-PREVIEW-001",
      date: new Date().toISOString().split("T")[0],
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
      client: "Preview Client LLC",
      items: [
        { description: "Strategy Services", hours: 20, rate: 150, total: 3000 },
        { description: "Development — Frontend", hours: 40, rate: 125, total: 5000 },
        { description: "Project Management", hours: 10, rate: 100, total: 1000 },
      ],
      subtotal: 9000,
      tax: 720,
      total: 9720,
    },
    pdfReady: true,
  });
});

app.post("/api/admin/invoice-themes/regenerate-pdf", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Custom Invoice Themes"))) return;
    const orgId = req.session.orgId!;
    const { invoiceId } = req.body;
    if (!invoiceId) return res.status(400).json({ message: "invoiceId is required" });

    const settings = orgThemeSettings.get(orgId) || { themeKey: "modern", brandColor: "#2563eb", logoUrl: null, updatedAt: new Date() };
    const theme = BUILT_IN_THEMES.find(t => t.key === settings.themeKey);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'INVOICE_PDF_REGENERATED', 'invoice', $3, $4)`,
      [orgId, req.session.userId, invoiceId, JSON.stringify({ theme: settings.themeKey, brandColor: settings.brandColor })]
    );

    return res.json({
      success: true,
      invoiceId,
      theme: settings.themeKey,
      brandColor: settings.brandColor,
      logoUrl: settings.logoUrl,
      regeneratedAt: new Date().toISOString(),
      pdfUrl: `/api/invoices/${invoiceId}/pdf`,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
