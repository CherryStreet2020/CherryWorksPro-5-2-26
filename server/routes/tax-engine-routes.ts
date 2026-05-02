import type { Express, Request, Response } from "express";
import { requireAuth, requireAdmin , requirePlanTier } from "./middleware";
import { pool } from "../db";
import { randomUUID } from "crypto";

interface TaxRate {
  id: string; jurisdiction: string; region: string;
  type: "sales_tax" | "vat"; rate: number;
  state?: string; county?: string; city?: string;
  country?: string; reverseCharge?: boolean;
  effectiveDate: string; expiryDate?: string;
}

interface ExemptionCert {
  id: string; orgId: string; clientId: string;
  certNumber: string; jurisdiction: string;
  validFrom: string; validTo: string;
  status: "active" | "expired" | "revoked";
  reason: string; createdAt: string;
}

const taxRates = new Map<string, TaxRate>();
const exemptionCerts = new Map<string, ExemptionCert>();
const taxApplications = new Map<string, any>();

const US_TAX_RATES: TaxRate[] = [
  { id: "us-ca-state", jurisdiction: "US", region: "CA", type: "sales_tax", rate: 7.25, state: "CA", effectiveDate: "2020-01-01" },
  { id: "us-ca-la-county", jurisdiction: "US", region: "CA-LA", type: "sales_tax", rate: 2.25, state: "CA", county: "Los Angeles", effectiveDate: "2020-01-01" },
  { id: "us-ca-la-city", jurisdiction: "US", region: "CA-LA-LA", type: "sales_tax", rate: 0.75, state: "CA", county: "Los Angeles", city: "Los Angeles", effectiveDate: "2020-01-01" },
  { id: "us-ny-state", jurisdiction: "US", region: "NY", type: "sales_tax", rate: 4.0, state: "NY", effectiveDate: "2020-01-01" },
  { id: "us-ny-nyc", jurisdiction: "US", region: "NY-NYC", type: "sales_tax", rate: 4.5, state: "NY", county: "New York City", effectiveDate: "2020-01-01" },
  { id: "us-tx-state", jurisdiction: "US", region: "TX", type: "sales_tax", rate: 6.25, state: "TX", effectiveDate: "2020-01-01" },
  { id: "us-fl-state", jurisdiction: "US", region: "FL", type: "sales_tax", rate: 6.0, state: "FL", effectiveDate: "2020-01-01" },
];

const EU_VAT_RATES: TaxRate[] = [
  { id: "eu-de", jurisdiction: "EU", region: "DE", type: "vat", rate: 19, country: "DE", reverseCharge: false, effectiveDate: "2020-01-01" },
  { id: "eu-fr", jurisdiction: "EU", region: "FR", type: "vat", rate: 20, country: "FR", reverseCharge: false, effectiveDate: "2020-01-01" },
  { id: "eu-nl", jurisdiction: "EU", region: "NL", type: "vat", rate: 21, country: "NL", reverseCharge: false, effectiveDate: "2020-01-01" },
  { id: "eu-ie", jurisdiction: "EU", region: "IE", type: "vat", rate: 23, country: "IE", reverseCharge: false, effectiveDate: "2020-01-01" },
  { id: "eu-es", jurisdiction: "EU", region: "ES", type: "vat", rate: 21, country: "ES", reverseCharge: false, effectiveDate: "2020-01-01" },
  { id: "eu-it", jurisdiction: "EU", region: "IT", type: "vat", rate: 22, country: "IT", reverseCharge: false, effectiveDate: "2020-01-01" },
];

for (const r of [...US_TAX_RATES, ...EU_VAT_RATES]) taxRates.set(r.id, r);

export function registerTaxEngineRoutes(app: Express) {
  app.get("/api/admin/tax-engine/rates", requireAdmin, (req: Request, res: Response) => {
    const jurisdiction = req.query.jurisdiction as string | undefined;
    let rates = Array.from(taxRates.values());
    if (jurisdiction) rates = rates.filter((r) => r.jurisdiction === jurisdiction);
    res.json({ success: true, count: rates.length, rates, jurisdictions: ["US", "EU"] });
  });

  app.post("/api/admin/tax-engine/rates", requireAdmin, async (req: Request, res: Response) => {
    try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Multi-Jurisdiction Tax Engine"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const { jurisdiction, region, type, rate, state, county, city, country, reverseCharge } = req.body;
      if (!jurisdiction || !region || !type || rate === undefined)
        return res.status(400).json({ error: "jurisdiction, region, type, rate required" });
      if (!["sales_tax", "vat"].includes(type))
        return res.status(400).json({ error: "type must be sales_tax or vat" });

      const id = randomUUID();
      const taxRate: TaxRate = {
        id, jurisdiction, region, type, rate: Number(rate),
        state, county, city, country, reverseCharge: !!reverseCharge,
        effectiveDate: new Date().toISOString().split("T")[0],
      };
      taxRates.set(id, taxRate);

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'TAX_RATE_CREATED', 'tax_rate', $3, $4)`,
        [orgId, userId, id, JSON.stringify({ jurisdiction, region, rate })]
      );

      return res.json({ success: true, rate: taxRate });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/tax-engine/calculate", requireAdmin, async (req: Request, res: Response) => {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Multi-Jurisdiction Tax Engine"))) return;
    const { invoiceAmount, billToState, billToCounty, billToCity, billToCountry, clientId } = req.body;
    if (!invoiceAmount) return res.status(400).json({ error: "invoiceAmount required" });

    const amount = Number(invoiceAmount);
    const exempt = clientId ? Array.from(exemptionCerts.values()).find(
      (c) => c.clientId === clientId && c.status === "active"
    ) : null;

    if (exempt) {
      return res.json({
        success: true, exempt: true, exemptionCertId: exempt.id,
        taxLines: [], totalTax: 0, totalWithTax: amount,
        glAccount: "2300",
      });
    }

    const taxLines: any[] = [];
    let totalTax = 0;

    if (billToState) {
      const stateRates = Array.from(taxRates.values()).filter(
        (r) => r.type === "sales_tax" && r.state === billToState
      );
      for (const r of stateRates) {
        if (r.county && billToCounty && r.county !== billToCounty) continue;
        if (r.city && billToCity && r.city !== billToCity) continue;
        if (r.county && !billToCounty) continue;
        if (r.city && !billToCity) continue;
        const tax = Math.round(amount * r.rate) / 100;
        taxLines.push({
          rateId: r.id, jurisdiction: r.jurisdiction, region: r.region,
          rate: r.rate, taxAmount: tax, description: `${r.state}${r.county ? ` - ${r.county}` : ""}${r.city ? ` - ${r.city}` : ""} Sales Tax (${r.rate}%)`,
        });
        totalTax += tax;
      }
    }

    if (billToCountry) {
      const vatRates = Array.from(taxRates.values()).filter(
        (r) => r.type === "vat" && r.country === billToCountry
      );
      for (const r of vatRates) {
        if (r.reverseCharge) {
          taxLines.push({ rateId: r.id, jurisdiction: "EU", region: r.region, rate: r.rate, taxAmount: 0, description: `${r.country} VAT - Reverse Charge`, reverseCharge: true });
        } else {
          const tax = Math.round(amount * r.rate) / 100;
          taxLines.push({ rateId: r.id, jurisdiction: "EU", region: r.region, rate: r.rate, taxAmount: tax, description: `${r.country} VAT (${r.rate}%)` });
          totalTax += tax;
        }
      }
    }

    totalTax = Math.round(totalTax * 100) / 100;

    const appId = randomUUID();
    taxApplications.set(appId, { id: appId, orgId: req.session.orgId!, invoiceAmount: amount, taxLines, totalTax, totalWithTax: Math.round((amount + totalTax) * 100) / 100, glAccount: "2300", createdAt: new Date().toISOString() });

    res.json({
      success: true, exempt: false, taxLines, totalTax,
      totalWithTax: Math.round((amount + totalTax) * 100) / 100,
      glAccount: "2300", applicationId: appId,
    });
  });

  app.post("/api/admin/tax-engine/exemptions", requireAdmin, async (req: Request, res: Response) => {
    try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Multi-Jurisdiction Tax Engine"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const { clientId, certNumber, jurisdiction, validFrom, validTo, reason } = req.body;
      if (!clientId || !certNumber || !jurisdiction) return res.status(400).json({ error: "clientId, certNumber, jurisdiction required" });

      const id = randomUUID();
      const cert: ExemptionCert = {
        id, orgId, clientId, certNumber, jurisdiction,
        validFrom: validFrom || new Date().toISOString().split("T")[0],
        validTo: validTo || new Date(Date.now() + 365 * 86400000).toISOString().split("T")[0],
        status: "active", reason: reason || "Tax exempt", createdAt: new Date().toISOString(),
      };
      exemptionCerts.set(id, cert);

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'TAX_EXEMPTION_CREATED', 'exemption_cert', $3, $4)`,
        [orgId, userId, id, JSON.stringify({ clientId, certNumber, jurisdiction })]
      );

      return res.json({ success: true, exemption: cert });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/tax-engine/exemptions", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const certs = Array.from(exemptionCerts.values()).filter((c) => c.orgId === orgId);
    res.json({ success: true, count: certs.length, exemptions: certs });
  });

  app.post("/api/admin/tax-engine/apply-to-invoice", requireAdmin, async (req: Request, res: Response) => {
    try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Multi-Jurisdiction Tax Engine"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const { invoiceId, applicationId } = req.body;
      if (!invoiceId || !applicationId) return res.status(400).json({ error: "invoiceId, applicationId required" });

      const app = taxApplications.get(applicationId);
      if (!app || app.orgId !== orgId) return res.status(404).json({ error: "Tax application not found" });

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'TAX_APPLIED_TO_INVOICE', 'invoice', $3, $4)`,
        [orgId, userId, invoiceId, JSON.stringify({ applicationId, totalTax: app.totalTax, glAccount: "2300" })]
      );

      return res.json({
        success: true, applied: true, invoiceId, totalTax: app.totalTax,
        taxLines: app.taxLines, glPostings: [
          { account: "2300", description: "Sales Tax / VAT Payable", credit: app.totalTax },
        ],
      });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/tax-engine/reverse-charge/rules", requireAdmin, (_req: Request, res: Response) => {
    res.json({
      success: true,
      rules: [
        { scenario: "B2B intra-EU", reverseCharge: true, description: "VAT reverse charge applies for B2B transactions within the EU" },
        { scenario: "B2C intra-EU", reverseCharge: false, description: "Standard VAT applies for B2C transactions" },
        { scenario: "Non-EU export", reverseCharge: false, description: "Zero-rated for exports outside the EU" },
      ],
    });
  });
}
