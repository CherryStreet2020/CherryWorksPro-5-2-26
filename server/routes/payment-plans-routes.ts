import type { Express, Request, Response } from "express";
import { requireAdmin , requirePlanTier } from "./middleware";
import { pool } from "../db";
import { randomUUID } from "crypto";

interface Installment {
  id: string; planId: string; number: number;
  amount: number; dueDate: string;
  status: "pending" | "paid" | "overdue" | "partial";
  paidAmount: number; paidDate: string | null;
  paymentId: string | null;
}

interface PaymentPlan {
  id: string; orgId: string; invoiceId: string;
  totalAmount: number; installmentCount: number;
  installments: Installment[];
  status: "active" | "completed" | "cancelled";
  createdAt: string; completedAt: string | null;
}

const paymentPlans = new Map<string, PaymentPlan>();

export function registerPaymentPlansRoutes(app: Express) {
  app.post("/api/admin/payment-plans", requireAdmin, async (req: Request, res: Response) => {
    try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Payment Plans"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const { invoiceId, totalAmount, installmentCount, startDate, intervalDays } = req.body;

      if (!invoiceId || !totalAmount || !installmentCount)
        return res.status(400).json({ error: "invoiceId, totalAmount, installmentCount required" });
      if (installmentCount < 2 || installmentCount > 24)
        return res.status(400).json({ error: "installmentCount must be 2-24" });

      const amount = Number(totalAmount);
      const count = Number(installmentCount);
      const interval = Number(intervalDays) || 30;
      const start = startDate ? new Date(startDate) : new Date();

      const perInstallment = Math.floor(amount * 100 / count) / 100;
      const remainder = Math.round((amount - perInstallment * count) * 100) / 100;

      const planId = randomUUID();
      const installments: Installment[] = [];

      for (let i = 0; i < count; i++) {
        const dueDate = new Date(start.getTime() + i * interval * 86400000);
        const instAmount = i === count - 1 ? perInstallment + remainder : perInstallment;
        installments.push({
          id: randomUUID(), planId, number: i + 1,
          amount: Math.round(instAmount * 100) / 100,
          dueDate: dueDate.toISOString().split("T")[0],
          status: "pending", paidAmount: 0, paidDate: null, paymentId: null,
        });
      }

      const plan: PaymentPlan = {
        id: planId, orgId, invoiceId, totalAmount: amount,
        installmentCount: count, installments,
        status: "active", createdAt: new Date().toISOString(), completedAt: null,
      };
      paymentPlans.set(planId, plan);

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'PAYMENT_PLAN_CREATED', 'payment_plan', $3, $4)`,
        [orgId, userId, planId, JSON.stringify({ invoiceId, totalAmount: amount, installments: count })]
      );

      return res.json({ success: true, plan });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/payment-plans", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const plans = Array.from(paymentPlans.values()).filter((p) => p.orgId === orgId);
    res.json({ success: true, count: plans.length, plans });
  });

  app.get("/api/admin/payment-plans/:planId", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const plan = paymentPlans.get(req.params.planId as string);
    if (!plan) return res.status(404).json({ error: "Payment plan not found" });
    if (plan.orgId !== orgId) return res.status(403).json({ error: "Wrong org" });

    const totalPaid = plan.installments.reduce((s, i) => s + i.paidAmount, 0);
    const paidCount = plan.installments.filter((i) => i.status === "paid").length;
    const overdueCount = plan.installments.filter((i) => i.status === "overdue").length;

    res.json({
      success: true, plan,
      summary: { totalPaid: Math.round(totalPaid * 100) / 100, remainingBalance: Math.round((plan.totalAmount - totalPaid) * 100) / 100, paidCount, overdueCount, totalInstallments: plan.installmentCount },
    });
  });

  app.post("/api/admin/payment-plans/:planId/pay-installment", requireAdmin, async (req: Request, res: Response) => {
    try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Payment Plans"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const plan = paymentPlans.get(req.params.planId as string);
      if (!plan) return res.status(404).json({ error: "Payment plan not found" });
      if (plan.orgId !== orgId) return res.status(403).json({ error: "Wrong org" });

      const { installmentNumber, amount, paymentId } = req.body;
      if (!installmentNumber || !amount) return res.status(400).json({ error: "installmentNumber, amount required" });

      const installment = plan.installments.find((i) => i.number === Number(installmentNumber));
      if (!installment) return res.status(404).json({ error: "Installment not found" });
      if (installment.status === "paid") return res.status(400).json({ error: "Installment already fully paid" });

      const payAmount = Number(amount);
      installment.paidAmount = Math.round((installment.paidAmount + payAmount) * 100) / 100;
      installment.paymentId = paymentId || randomUUID();
      installment.paidDate = new Date().toISOString().split("T")[0];

      if (installment.paidAmount >= installment.amount) {
        installment.status = "paid";
      } else {
        installment.status = "partial";
      }

      const allPaid = plan.installments.every((i) => i.status === "paid");
      if (allPaid) { plan.status = "completed"; plan.completedAt = new Date().toISOString(); }

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'INSTALLMENT_PAYMENT_RECORDED', 'payment_plan', $3, $4)`,
        [orgId, userId, plan.id, JSON.stringify({ installmentNumber, amount: payAmount, installmentStatus: installment.status })]
      );

      const totalPaid = plan.installments.reduce((s, i) => s + i.paidAmount, 0);

      return res.json({
        success: true, installment, planStatus: plan.status,
        glParity: { debit: { account: "1000", amount: payAmount, description: "Cash received" }, credit: { account: "1200", amount: payAmount, description: "AR reduction" } },
        summary: { totalPaid: Math.round(totalPaid * 100) / 100, remainingBalance: Math.round((plan.totalAmount - totalPaid) * 100) / 100 },
      });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.post("/api/admin/payment-plans/:planId/cancel", requireAdmin, async (req: Request, res: Response) => {
    try {
  if (!(await requirePlanTier(req, res, ["BUSINESS","ENTERPRISE"], "Payment Plans"))) return;
      const orgId = req.session.orgId!;
      const userId = req.session.userId!;
      const plan = paymentPlans.get(req.params.planId as string);
      if (!plan) return res.status(404).json({ error: "Payment plan not found" });
      if (plan.orgId !== orgId) return res.status(403).json({ error: "Wrong org" });
      if (plan.status !== "active") return res.status(400).json({ error: `Cannot cancel: plan is ${plan.status}` });

      plan.status = "cancelled";

      await pool.query(
        `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details) VALUES (gen_random_uuid(), $1, $2, 'PAYMENT_PLAN_CANCELLED', 'payment_plan', $3, $4)`,
        [orgId, userId, plan.id, JSON.stringify({ reason: req.body.reason || "Admin cancelled" })]
      );

      return res.json({ success: true, cancelled: true, plan });
    } catch (e: any) { return res.status(500).json({ error: e.message }); }
  });

  app.get("/api/admin/payment-plans/:planId/schedule", requireAdmin, (req: Request, res: Response) => {
    const orgId = req.session.orgId!;
    const plan = paymentPlans.get(req.params.planId as string);
    if (!plan) return res.status(404).json({ error: "Payment plan not found" });
    if (plan.orgId !== orgId) return res.status(403).json({ error: "Wrong org" });

    res.json({
      success: true,
      schedule: plan.installments.map((i) => ({
        number: i.number, amount: i.amount, dueDate: i.dueDate,
        status: i.status, paidAmount: i.paidAmount, paidDate: i.paidDate,
      })),
    });
  });
}
