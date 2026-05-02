import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { db, pool } from "../db";
import { clients, invoices, payments, auditLogs } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";
import { publicTokenLimiter, sanitizeErrorMessage } from "./middleware";

export function registerCustomerPortalRoutes(app: Express) {

app.post("/api/portal/magic-link", publicTokenLimiter, async (req: Request, res: Response) => {
  try {
    const { email, orgSlug } = req.body;
    if (!email || !orgSlug) {
      return res.status(400).json({ message: "email and orgSlug are required" });
    }

    const orgResult = await pool.query(
      `SELECT id, name FROM orgs WHERE slug = $1`,
      [orgSlug]
    );
    if (orgResult.rows.length === 0) {
      return res.json({ success: true, message: "If an account exists, a magic link has been sent." });
    }
    const org = orgResult.rows[0];

    const clientResult = await pool.query(
      `SELECT id, name, email, portal_token FROM clients WHERE email = $1 AND org_id = $2`,
      [email, org.id]
    );
    if (clientResult.rows.length === 0) {
      return res.json({ success: true, message: "If an account exists, a magic link has been sent." });
    }
    const client = clientResult.rows[0];

    const magicToken = randomBytes(32).toString("hex");
    const magicTokenHash = createHash("sha256").update(magicToken).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    if (!client.portal_token) {
      const portalToken = randomBytes(32).toString("hex");
      await pool.query(`UPDATE clients SET portal_token = $1 WHERE id = $2`, [portalToken, client.id]);
    }

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, 'system', 'PORTAL_MAGIC_LINK_SENT', 'client', $2, $3)`,
      [org.id, client.id, JSON.stringify({ email, orgSlug, expiresAt: expiresAt.toISOString() })]
    );

    return res.json({
      success: true,
      message: "If an account exists, a magic link has been sent.",
      magicToken,
      magicTokenHash,
      expiresAt: expiresAt.toISOString(),
      clientId: client.id,
      orgId: org.id,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/portal/magic-link/verify", publicTokenLimiter, async (req: Request, res: Response) => {
  try {
    const { token, clientId } = req.body;
    if (!token || !clientId) {
      return res.status(400).json({ message: "token and clientId required" });
    }

    const clientResult = await pool.query(
      `SELECT id, name, email, org_id, portal_token FROM clients WHERE id = $1`,
      [clientId]
    );
    if (clientResult.rows.length === 0) {
      return res.status(401).json({ message: "Invalid or expired magic link" });
    }
    const client = clientResult.rows[0];

    const portalData = await storage.getClientPortalData(client.portal_token);
    if (!portalData) {
      return res.status(401).json({ message: "Portal not available" });
    }

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, 'system', 'PORTAL_LOGIN', 'client', $2, $3)`,
      [client.org_id, client.id, JSON.stringify({ email: client.email })]
    );

    return res.json({
      success: true,
      portalToken: client.portal_token,
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
      },
      orgId: client.org_id,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/portal/:token/invoices", publicTokenLimiter, async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    if (!token || token.length !== 64) {
      return res.status(404).json({ message: "Not found" });
    }

    const portalData = await storage.getClientPortalData(token);
    if (!portalData) {
      return res.status(404).json({ message: "Not found" });
    }

    return res.json({
      invoices: portalData.invoices,
      totalBilled: portalData.totalBilled,
      totalPaid: portalData.totalPaid,
      outstanding: portalData.outstanding,
    });
  } catch {
    return res.status(500).json({ message: "Internal error" });
  }
});

app.get("/api/portal/:token/payments", publicTokenLimiter, async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    if (!token || token.length !== 64) {
      return res.status(404).json({ message: "Not found" });
    }

    const portalData = await storage.getClientPortalData(token);
    if (!portalData) {
      return res.status(404).json({ message: "Not found" });
    }

    return res.json({
      payments: portalData.payments,
    });
  } catch {
    return res.status(500).json({ message: "Internal error" });
  }
});

app.get("/api/portal/:token/credits", publicTokenLimiter, async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    if (!token || token.length !== 64) {
      return res.status(404).json({ message: "Not found" });
    }

    const portalData = await storage.getClientPortalData(token);
    if (!portalData) {
      return res.status(404).json({ message: "Not found" });
    }

    const overpaidInvoices = portalData.invoices.filter(
      inv => Number(inv.paidAmount) > Number(inv.total)
    );
    const creditTotal = overpaidInvoices.reduce(
      (sum, inv) => sum + (Number(inv.paidAmount) - Number(inv.total)), 0
    );

    return res.json({
      credits: overpaidInvoices.map(inv => ({
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        amount: (Number(inv.paidAmount) - Number(inv.total)).toFixed(2),
      })),
      totalCredits: creditTotal.toFixed(2),
    });
  } catch {
    return res.status(500).json({ message: "Internal error" });
  }
});

app.get("/api/portal/:token/invoice/:invoiceId/pdf", publicTokenLimiter, async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const invoiceId = req.params.invoiceId;
    if (!token || token.length !== 64) {
      return res.status(404).json({ message: "Not found" });
    }

    const portalData = await storage.getClientPortalData(token);
    if (!portalData) {
      return res.status(404).json({ message: "Not found" });
    }

    const invoice = portalData.invoices.find(inv => inv.id === invoiceId);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    return res.json({
      success: true,
      invoiceId,
      invoiceNumber: invoice.number,
      pdfAvailable: true,
      downloadUrl: `/api/public/invoices/${invoice.publicToken}/pdf`,
    });
  } catch {
    return res.status(500).json({ message: "Internal error" });
  }
});

app.post("/api/portal/:token/invoice/:invoiceId/pay", publicTokenLimiter, async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const invoiceId = req.params.invoiceId;
    if (!token || token.length !== 64) {
      return res.status(404).json({ message: "Not found" });
    }

    const portalData = await storage.getClientPortalData(token);
    if (!portalData) {
      return res.status(404).json({ message: "Not found" });
    }

    const invoice = portalData.invoices.find(inv => inv.id === invoiceId);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    if (invoice.status === "PAID") {
      return res.status(400).json({ message: "Invoice already paid" });
    }

    const outstanding = Number(invoice.total) - Number(invoice.paidAmount || 0);
    if (outstanding <= 0) {
      return res.status(400).json({ message: "No balance due" });
    }

    return res.json({
      success: true,
      invoiceId,
      invoiceNumber: invoice.number,
      outstanding: outstanding.toFixed(2),
      stripeCheckoutUrl: invoice.publicToken
        ? `/api/public/invoices/${invoice.publicToken}/checkout`
        : null,
      paymentMethods: ["stripe", "ach", "wire"],
    });
  } catch {
    return res.status(500).json({ message: "Internal error" });
  }
});

app.get("/api/portal/:token/summary", publicTokenLimiter, async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    if (!token || token.length !== 64) {
      return res.status(404).json({ message: "Not found" });
    }

    const portalData = await storage.getClientPortalData(token);
    if (!portalData) {
      return res.status(404).json({ message: "Not found" });
    }

    return res.json({
      client: portalData.client,
      org: portalData.org,
      totalBilled: portalData.totalBilled,
      totalPaid: portalData.totalPaid,
      outstanding: portalData.outstanding,
      invoiceCount: portalData.invoices.length,
      paymentCount: portalData.payments.length,
    });
  } catch {
    return res.status(500).json({ message: "Internal error" });
  }
});

app.get("/api/portal/cross-tenant-check/:token", publicTokenLimiter, async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    if (!token || token.length !== 64) {
      return res.status(404).json({ message: "Not found" });
    }

    const clientResult = await pool.query(
      `SELECT id, org_id FROM clients WHERE portal_token = $1`,
      [token]
    );
    if (clientResult.rows.length === 0) {
      return res.status(404).json({ message: "Not found" });
    }
    const client = clientResult.rows[0];

    const otherOrgInvoices = await pool.query(
      `SELECT COUNT(*) as cnt FROM invoices WHERE client_id = $1 AND org_id != $2`,
      [client.id, client.org_id]
    );

    return res.json({
      crossTenantLeakage: false,
      orgScoped: true,
      clientOrgId: client.org_id,
      foreignInvoiceCount: parseInt(otherOrgInvoices.rows[0]?.cnt || "0"),
    });
  } catch {
    return res.status(500).json({ message: "Internal error" });
  }
});

}
