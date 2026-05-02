import type { Express, Request, Response } from "express";
import { requireAuth, requireAdmin , requirePlanTier } from "./middleware";
import { pool } from "../db";
import { randomUUID } from "crypto";

interface ExpenseSubmission {
  id: string; orgId: string; userId: string; userName: string;
  amount: number; currency: string; category: string;
  description: string; vendor: string;
  receiptOcrId?: string; receiptFileName?: string;
  status: "submitted" | "approved" | "rejected" | "paid";
  submittedAt: string; reviewedAt: string | null;
  reviewedBy: string | null; rejectionReason: string | null;
  reimbursementPaymentId: string | null;
  paidAt: string | null; paidAmount: number | null;
}

const expenseSubmissions = new Map<string, ExpenseSubmission>();

export function registerExpenseReimbursementRoutes(app: Express) {
  app.post("/api/expenses/submit-reimbursement", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Expense Approval Workflow"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const { amount, currency, category, description, vendor, receiptOcrId, receiptFileName } = req.body;

      if (!amount || !category || !description)
        return res.status(400).json({ error: "amount, category, description required" });

      const id = randomUUID();
      const submission: ExpenseSubmission = {
        id, orgId, userId, userName: "Current User",
        amount: Number(amount), currency: currency || "USD",
        category, description, vendor: vendor || "Unknown",
        receiptOcrId, receiptFileName,
        status: "submitted", submittedAt: new Date().toISOString(),
        reviewedAt: null, reviewedBy: null, rejectionReason: null,
        reimbursementPaymentId: null, paidAt: null, paidAmount: null,
      };
      expenseSubmissions.set(id, submission);

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'EXPENSE_REIMBURSEMENT_SUBMITTED', 'expense_reimbursement', $3, $4)`,
        [orgId, userId, id, JSON.stringify({ amount: submission.amount, category, vendor: submission.vendor })]
      );

      return res.json({ success: true, submission });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/expenses/my-reimbursements", requireAuth, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const subs = Array.from(expenseSubmissions.values())
      .filter((s) => s.orgId === orgId && s.userId === userId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    res.json({ success: true, count: subs.length, submissions: subs });
  });

  app.get("/api/admin/expense-reimbursements", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const statusFilter = req.query.status as string | undefined;
    let subs = Array.from(expenseSubmissions.values()).filter((s) => s.orgId === orgId);
    if (statusFilter) subs = subs.filter((s) => s.status === statusFilter);
    subs.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

    const pending = subs.filter((s) => s.status === "submitted").length;
    const approved = subs.filter((s) => s.status === "approved").length;
    const totalOwed = subs.filter((s) => s.status === "approved").reduce((sum, s) => sum + s.amount, 0);

    res.json({ success: true, count: subs.length, submissions: subs, summary: { pending, approved, totalOwed: Math.round(totalOwed * 100) / 100 } });
  });

  app.get("/api/admin/expense-reimbursements/:id", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const sub = expenseSubmissions.get(req.params.id as string);
    if (!sub) return res.status(404).json({ error: "Submission not found" });
    if (sub.orgId !== orgId) return res.status(403).json({ error: "Wrong org" });
    res.json({ success: true, submission: sub });
  });

  app.post("/api/admin/expense-reimbursements/:id/approve", requireAdmin, async (req: Request, res: Response) => {
    try {
      if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Expense Approval Workflow"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const sub = expenseSubmissions.get(req.params.id as string);
      if (!sub) return res.status(404).json({ error: "Submission not found" });
      if (sub.orgId !== orgId) return res.status(403).json({ error: "Wrong org" });
      if (sub.status !== "submitted") return res.status(400).json({ error: `Cannot approve: status is ${sub.status}` });

      sub.status = "approved";
      sub.reviewedAt = new Date().toISOString();
      sub.reviewedBy = userId;

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'EXPENSE_REIMBURSEMENT_APPROVED', 'expense_reimbursement', $3, $4)`,
        [orgId, userId, sub.id, JSON.stringify({ amount: sub.amount, teamMember: sub.userId })]
      );

      return res.json({ success: true, approved: true, submission: sub });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });
  app.post("/api/admin/expense-reimbursements/:id/reject", requireAdmin, async (req: Request, res: Response) => {
    try {
      if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Expense Approval Workflow"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const sub = expenseSubmissions.get(req.params.id as string);
      if (!sub) return res.status(404).json({ error: "Submission not found" });
      if (sub.orgId !== orgId) return res.status(403).json({ error: "Wrong org" });
      if (sub.status !== "submitted") return res.status(400).json({ error: `Cannot reject: status is ${sub.status}` });

      sub.status = "rejected";
      sub.reviewedAt = new Date().toISOString();
      sub.reviewedBy = userId;
      sub.rejectionReason = req.body.reason || "No reason provided";

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'EXPENSE_REIMBURSEMENT_REJECTED', 'expense_reimbursement', $3, $4)`,
        [orgId, userId, sub.id, JSON.stringify({ amount: sub.amount, reason: sub.rejectionReason })]
      );

      return res.json({ success: true, rejected: true, submission: sub });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/expense-reimbursements/:id/pay", requireAdmin, async (req: Request, res: Response) => {
    try {
      if (!(await requirePlanTier(req, res, ["PROFESSIONAL", "BUSINESS", "ENTERPRISE"], "Expense Approval Workflow"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const sub = expenseSubmissions.get(req.params.id as string);
      if (!sub) return res.status(404).json({ error: "Submission not found" });
      if (sub.orgId !== orgId) return res.status(403).json({ error: "Wrong org" });
      if (sub.status !== "approved") return res.status(400).json({ error: `Cannot pay: status is ${sub.status}` });

      const paymentId = randomUUID();
      sub.status = "paid";
      sub.reimbursementPaymentId = paymentId;
      sub.paidAt = new Date().toISOString();
      sub.paidAmount = sub.amount;

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'EXPENSE_REIMBURSEMENT_PAID', 'expense_reimbursement', $3, $4)`,
        [orgId, userId, sub.id, JSON.stringify({ paymentId, amount: sub.amount, teamMember: sub.userId })]
      );

      return res.json({
        success: true, paid: true, submission: sub,
        payment: { id: paymentId, amount: sub.amount, type: "outflow", paidTo: sub.userId },
        glPostings: [
          { account: "6000", debit: sub.amount, description: "Expense reimbursement" },
          { account: "1000", credit: sub.amount, description: "Cash outflow" },
        ],
      });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });
}
