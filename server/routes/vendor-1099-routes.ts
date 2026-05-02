import type { Express, Request, Response } from "express";
import { requireAdmin , requirePlanTier } from "./middleware";
import { pool } from "../db";
import { randomUUID } from "crypto";

interface Vendor {
  id: string; orgId: string; name: string; legalName: string;
  tin: string; tinType: "SSN" | "EIN"; classification: "individual" | "sole_prop" | "llc" | "corporation" | "partnership";
  address: string; city: string; state: string; zip: string; country: string;
  email: string; phone: string;
  w9OnFile: boolean; w9ReceivedDate: string | null;
  is1099Eligible: boolean; createdAt: string;
}

interface VendorPayment {
  id: string; vendorId: string; orgId: string;
  amount: number; date: string; description: string; year: number;
}

const vendors = new Map<string, Vendor>();
const vendorPayments = new Map<string, VendorPayment>();

export function registerVendor1099Routes(app: Express) {
  app.post("/api/admin/vendors", requireAdmin, async (req: Request, res: Response) => {
    try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Vendor 1099 Management"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const { name, legalName, tin, tinType, classification, address, city, state, zip, country, email, phone, w9OnFile, is1099Eligible } = req.body;

      if (!name || !tin || !classification) return res.status(400).json({ error: "name, tin, classification required" });
      if (!["individual", "sole_prop", "llc", "corporation", "partnership"].includes(classification))
        return res.status(400).json({ error: "Invalid classification" });

      const id = randomUUID();
      const vendor: Vendor = {
        id, orgId, name, legalName: legalName || name,
        tin, tinType: tinType || "EIN", classification,
        address: address || "", city: city || "", state: state || "", zip: zip || "", country: country || "US",
        email: email || "", phone: phone || "",
        w9OnFile: !!w9OnFile, w9ReceivedDate: w9OnFile ? new Date().toISOString().split("T")[0] : null,
        is1099Eligible: is1099Eligible !== false, createdAt: new Date().toISOString(),
      };
      vendors.set(id, vendor);

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'VENDOR_CREATED', 'vendor', $3, $4)`,
        [orgId, userId, id, JSON.stringify({ name, classification, is1099Eligible: vendor.is1099Eligible })]
      );

      return res.json({ success: true, vendor });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/vendors", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const vends = Array.from(vendors.values()).filter((v) => v.orgId === orgId);
    res.json({ success: true, count: vends.length, vendors: vends });
  });

  app.get("/api/admin/vendors/:id", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const vendor = vendors.get(req.params.id as string);
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });
    if (vendor.orgId !== orgId) return res.status(403).json({ error: "Wrong org" });

    const payments = Array.from(vendorPayments.values()).filter((p) => p.vendorId === vendor.id);
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

    res.json({ success: true, vendor, totalPaid: Math.round(totalPaid * 100) / 100, paymentCount: payments.length });
  });

  app.post("/api/admin/vendors/:id/payments", requireAdmin, async (req: Request, res: Response) => {
    try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Vendor 1099 Management"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const vendor = vendors.get(req.params.id as string);
      if (!vendor) return res.status(404).json({ error: "Vendor not found" });
      if (vendor.orgId !== orgId) return res.status(403).json({ error: "Wrong org" });

      const { amount, date, description } = req.body;
      if (!amount) return res.status(400).json({ error: "amount required" });

      const payDate = date || new Date().toISOString().split("T")[0];
      const year = new Date(payDate).getFullYear();
      const payId = randomUUID();

      const payment: VendorPayment = {
        id: payId, vendorId: vendor.id, orgId,
        amount: Number(amount), date: payDate,
        description: description || "Vendor payment", year,
      };
      vendorPayments.set(payId, payment);

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'VENDOR_PAYMENT_RECORDED', 'vendor', $3, $4)`,
        [orgId, userId, vendor.id, JSON.stringify({ paymentId: payId, amount: payment.amount, date: payDate })]
      );

      return res.json({ success: true, payment });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/vendors/1099/summary", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const year = Number(req.query.year) || new Date().getFullYear();

    const eligibleVendors = Array.from(vendors.values()).filter((v) => v.orgId === orgId && v.is1099Eligible);
    const summary: any[] = [];

    for (const vendor of eligibleVendors) {
      const payments = Array.from(vendorPayments.values()).filter((p) => p.vendorId === vendor.id && p.year === year);
      const total = payments.reduce((s, p) => s + p.amount, 0);
      const rounded = Math.round(total * 100) / 100;
      summary.push({
        vendorId: vendor.id, name: vendor.name, legalName: vendor.legalName,
        tin: `***-**-${vendor.tin.slice(-4)}`, tinType: vendor.tinType,
        classification: vendor.classification,
        address: vendor.address, city: vendor.city, state: vendor.state, zip: vendor.zip,
        totalPaid: rounded, paymentCount: payments.length,
        meetsThreshold: rounded >= 600,
        w9OnFile: vendor.w9OnFile,
      });
    }

    const aboveThreshold = summary.filter((s) => s.meetsThreshold).length;

    res.json({ success: true, year, count: summary.length, aboveThreshold, threshold: 600, vendors: summary });
  });

  app.get("/api/admin/vendors/1099/export", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const year = Number(req.query.year) || new Date().getFullYear();

    const eligibleVendors = Array.from(vendors.values()).filter((v) => v.orgId === orgId && v.is1099Eligible);
    const rows: string[] = ["Legal Name,TIN Type,TIN (last 4),Classification,Address,City,State,ZIP,Total Paid,Meets $600 Threshold"];

    for (const vendor of eligibleVendors) {
      const payments = Array.from(vendorPayments.values()).filter((p) => p.vendorId === vendor.id && p.year === year);
      const total = Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
      rows.push(`"${vendor.legalName}",${vendor.tinType},***-${vendor.tin.slice(-4)},${vendor.classification},"${vendor.address}","${vendor.city}",${vendor.state},${vendor.zip},${total},${total >= 600 ? "Yes" : "No"}`);
    }

    res.json({ success: true, year, format: "csv", csvContent: rows.join("\n"), rowCount: rows.length - 1, exportedAt: new Date().toISOString() });
  });

  app.put("/api/admin/vendors/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Vendor 1099 Management"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const vendor = vendors.get(req.params.id as string);
      if (!vendor) return res.status(404).json({ error: "Vendor not found" });
      if (vendor.orgId !== orgId) return res.status(403).json({ error: "Wrong org" });

      const updates = req.body;
      if (updates.name) vendor.name = updates.name;
      if (updates.legalName) vendor.legalName = updates.legalName;
      if (updates.tin) vendor.tin = updates.tin;
      if (updates.address) vendor.address = updates.address;
      if (updates.w9OnFile !== undefined) { vendor.w9OnFile = !!updates.w9OnFile; if (vendor.w9OnFile) vendor.w9ReceivedDate = new Date().toISOString().split("T")[0]; }
      if (updates.is1099Eligible !== undefined) vendor.is1099Eligible = !!updates.is1099Eligible;

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'VENDOR_UPDATED', 'vendor', $3, $4)`,
        [orgId, userId, vendor.id, JSON.stringify({ updates: Object.keys(updates) })]
      );

      return res.json({ success: true, vendor });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });
}
