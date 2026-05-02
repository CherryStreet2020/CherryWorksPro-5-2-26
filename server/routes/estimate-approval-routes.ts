import type { Express, Request, Response } from "express";
import { requireAuth, requireAdmin, sanitizeErrorMessage , requirePlanTier } from "./middleware";
import { pool } from "../db";
import { randomUUID, createHash } from "crypto";

interface EstimateApproval {
  id: string;
  orgId: string;
  estimateId: string;
  token: string;
  clientEmail: string;
  clientName: string;
  status: "pending" | "approved" | "rejected";
  sentAt: Date;
  respondedAt: Date | null;
  signatureName: string | null;
  signatureIp: string | null;
  signatureTimestamp: Date | null;
  convertedInvoiceId: string | null;
}

const estimateApprovals = new Map<string, EstimateApproval>();
const tokenIndex = new Map<string, string>();

export function registerEstimateApprovalRoutes(app: Express) {

app.post("/api/admin/estimates/:estimateId/send-approval", requireAdmin, async (req: Request, res: Response) => {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Approval Workflows"))) return;
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { clientEmail, clientName } = req.body;
    const estimateId = req.params.estimateId;

    if (!clientEmail) return res.status(400).json({ message: "clientEmail is required" });
    if (!clientName) return res.status(400).json({ message: "clientName is required" });

    const token = createHash("sha256").update(randomUUID() + Date.now()).digest("hex").slice(0, 48);
    const id = randomUUID();

    const approval: EstimateApproval = {
      id,
      orgId,
      estimateId: estimateId as string,
      token,
      clientEmail,
      clientName,
      status: "pending",
      sentAt: new Date(),
      respondedAt: null,
      signatureName: null,
      signatureIp: null,
      signatureTimestamp: null,
      convertedInvoiceId: null,
    };

    estimateApprovals.set(id, approval);
    tokenIndex.set(token, id);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, 'ESTIMATE_APPROVAL_SENT', 'estimate', $3, $4)`,
      [orgId, userId, estimateId, JSON.stringify({ clientEmail, clientName, approvalId: id })]
    );

    return res.json({
      success: true,
      approvalId: id,
      approvalUrl: `/api/public/estimate-approval/${token}`,
      clientEmail,
      status: "pending",
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/public/estimate-approval/:token", async (req: Request, res: Response) => {
  try {
    const approvalId = tokenIndex.get(req.params.token as string);
    if (!approvalId) return res.status(404).json({ message: "Approval link not found or expired" });

    const approval = estimateApprovals.get(approvalId);
    if (!approval) return res.status(404).json({ message: "Approval not found" });

    return res.json({
      estimateId: approval.estimateId,
      clientName: approval.clientName,
      status: approval.status,
      sentAt: approval.sentAt.toISOString(),
      respondedAt: approval.respondedAt?.toISOString() || null,
      canRespond: approval.status === "pending",
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/public/estimate-approval/:token/approve", async (req: Request, res: Response) => {
  try {
    const approvalId = tokenIndex.get(req.params.token as string);
    if (!approvalId) return res.status(404).json({ message: "Approval link not found" });

    const approval = estimateApprovals.get(approvalId);
    if (!approval) return res.status(404).json({ message: "Approval not found" });
    if (approval.status !== "pending") return res.status(400).json({ message: `Already ${approval.status}` });

    const { signatureName } = req.body;
    if (!signatureName) return res.status(400).json({ message: "signatureName is required (typed name as digital signature)" });

    const clientIp = req.ip || req.headers["x-forwarded-for"]?.toString() || "unknown";
    const now = new Date();

    approval.status = "approved";
    approval.respondedAt = now;
    approval.signatureName = signatureName;
    approval.signatureIp = clientIp;
    approval.signatureTimestamp = now;

    const invoiceId = randomUUID();
    approval.convertedInvoiceId = invoiceId;

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, NULL, 'ESTIMATE_APPROVED_BY_CLIENT', 'estimate', $2, $3)`,
      [approval.orgId, approval.estimateId, JSON.stringify({
        approvalId,
        clientName: approval.clientName,
        signatureName,
        signatureIp: clientIp,
        signatureTimestamp: now.toISOString(),
        convertedInvoiceId: invoiceId,
      })]
    );

    return res.json({
      success: true,
      status: "approved",
      signature: {
        name: signatureName,
        ip: clientIp,
        timestamp: now.toISOString(),
      },
      convertedInvoiceId: invoiceId,
      message: "Estimate approved and converted to invoice",
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/public/estimate-approval/:token/reject", async (req: Request, res: Response) => {
  try {
    const approvalId = tokenIndex.get(req.params.token as string);
    if (!approvalId) return res.status(404).json({ message: "Approval link not found" });

    const approval = estimateApprovals.get(approvalId);
    if (!approval) return res.status(404).json({ message: "Approval not found" });
    if (approval.status !== "pending") return res.status(400).json({ message: `Already ${approval.status}` });

    const { reason } = req.body;
    approval.status = "rejected";
    approval.respondedAt = new Date();

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, NULL, 'ESTIMATE_REJECTED_BY_CLIENT', 'estimate', $2, $3)`,
      [approval.orgId, approval.estimateId, JSON.stringify({ approvalId, clientName: approval.clientName, reason: reason || "No reason given" })]
    );

    return res.json({ success: true, status: "rejected", reason: reason || "No reason given" });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/estimates/approvals", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const approvals = Array.from(estimateApprovals.values()).filter(a => a.orgId === orgId);
    return res.json({
      approvals: approvals.map(a => ({
        id: a.id,
        estimateId: a.estimateId,
        clientName: a.clientName,
        clientEmail: a.clientEmail,
        status: a.status,
        sentAt: a.sentAt.toISOString(),
        respondedAt: a.respondedAt?.toISOString() || null,
        hasSignature: !!a.signatureName,
        convertedInvoiceId: a.convertedInvoiceId,
      })),
      count: approvals.length,
      pending: approvals.filter(a => a.status === "pending").length,
      approved: approvals.filter(a => a.status === "approved").length,
      rejected: approvals.filter(a => a.status === "rejected").length,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/estimates/approvals/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const approval = estimateApprovals.get(req.params.id as string);
    if (!approval || approval.orgId !== orgId) return res.status(404).json({ message: "Approval not found" });

    return res.json({
      approval: {
        ...approval,
        sentAt: approval.sentAt.toISOString(),
        respondedAt: approval.respondedAt?.toISOString() || null,
        signatureTimestamp: approval.signatureTimestamp?.toISOString() || null,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
