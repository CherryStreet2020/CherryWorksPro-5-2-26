import type { Express, Request, Response } from "express";
import { requireAdmin, sanitizeErrorMessage , requirePlanTier } from "./middleware";
import { db, pool } from "../db";
import { randomUUID } from "crypto";

interface ChargeAttempt {
  id: string;
  orgId: string;
  invoiceId: string;
  clientId: string;
  amount: string;
  attempt: number;
  maxAttempts: number;
  status: "pending" | "succeeded" | "failed" | "dunning";
  stripePaymentIntentId: string | null;
  failureReason: string | null;
  nextRetryAt: Date | null;
  createdAt: Date;
  processedAt: Date | null;
}

const chargeAttempts = new Map<string, ChargeAttempt>();
const dunningQueue = new Map<string, { invoiceId: string; orgId: string; clientId: string; amount: string; failedAttempts: number; addedAt: Date; lastAttemptAt: Date }>();
const RETRY_DELAYS_DAYS = [1, 3, 7];

export function registerAutoChargeRoutes(app: Express) {

app.get("/api/admin/auto-charge/config", requireAdmin, async (_req: Request, res: Response) => {
  return res.json({
    enabled: true,
    maxAttempts: 3,
    retrySchedule: ["1 day", "3 days", "7 days"],
    retryDelaysDays: RETRY_DELAYS_DAYS,
    requiresSavedPaymentMethod: true,
    requiresStripeCustomer: true,
    dunningOnFailure: true,
    auditLogged: true,
  });
});

app.post("/api/admin/auto-charge/simulate", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Auto-Charge Recurring Billing"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { invoiceId, amount, clientId, simulateFailure } = req.body;

    if (!invoiceId) return res.status(400).json({ message: "invoiceId is required" });
    if (!amount) return res.status(400).json({ message: "amount is required" });

    const id = randomUUID();
    const shouldFail = simulateFailure === true;

    const attempt: ChargeAttempt = {
      id,
      orgId,
      invoiceId,
      clientId: clientId || "unknown",
      amount: String(amount),
      attempt: 1,
      maxAttempts: 3,
      status: shouldFail ? "failed" : "succeeded",
      stripePaymentIntentId: shouldFail ? null : `pi_sim_${randomUUID().slice(0, 8)}`,
      failureReason: shouldFail ? "card_declined" : null,
      nextRetryAt: shouldFail ? new Date(Date.now() + RETRY_DELAYS_DAYS[0] * 86400000) : null,
      createdAt: new Date(),
      processedAt: new Date(),
    };

    chargeAttempts.set(id, attempt);

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, $3, 'auto_charge', $4, $5)`,
      [orgId, userId,
       shouldFail ? "AUTO_CHARGE_FAILED" : "AUTO_CHARGE_SUCCEEDED",
       invoiceId,
       JSON.stringify({ attemptId: id, amount, attempt: 1, status: attempt.status, failureReason: attempt.failureReason, stripePaymentIntentId: attempt.stripePaymentIntentId })]
    );

    return res.json({ success: true, attempt });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/admin/auto-charge/retry", requireAdmin, async (req: Request, res: Response) => {
  try {
  if (!(await requirePlanTier(req, res, ["PROFESSIONAL","BUSINESS","ENTERPRISE"], "Auto-Charge Recurring Billing"))) return;
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const { attemptId, simulateFailure } = req.body;

    if (!attemptId) return res.status(400).json({ message: "attemptId is required" });
    const prev = chargeAttempts.get(attemptId);
    if (!prev || prev.orgId !== orgId) return res.status(404).json({ message: "Charge attempt not found" });

    const newAttemptNum = prev.attempt + 1;
    const shouldFail = simulateFailure === true;
    const isLastAttempt = newAttemptNum >= prev.maxAttempts;

    prev.attempt = newAttemptNum;
    prev.processedAt = new Date();

    if (shouldFail) {
      prev.status = isLastAttempt ? "dunning" : "failed";
      prev.failureReason = "card_declined";
      prev.nextRetryAt = isLastAttempt ? null : new Date(Date.now() + RETRY_DELAYS_DAYS[Math.min(newAttemptNum - 1, RETRY_DELAYS_DAYS.length - 1)] * 86400000);

      if (isLastAttempt) {
        dunningQueue.set(prev.invoiceId, {
          invoiceId: prev.invoiceId,
          orgId,
          clientId: prev.clientId,
          amount: prev.amount,
          failedAttempts: newAttemptNum,
          addedAt: new Date(),
          lastAttemptAt: new Date(),
        });
      }
    } else {
      prev.status = "succeeded";
      prev.stripePaymentIntentId = `pi_sim_${randomUUID().slice(0, 8)}`;
      prev.failureReason = null;
      prev.nextRetryAt = null;
    }

    await pool.query(
      `INSERT INTO audit_logs (id, org_id, user_id, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid(), $1, $2, $3, 'auto_charge', $4, $5)`,
      [orgId, userId,
       shouldFail ? (isLastAttempt ? "AUTO_CHARGE_DUNNING" : "AUTO_CHARGE_RETRY_FAILED") : "AUTO_CHARGE_RETRY_SUCCEEDED",
       prev.invoiceId,
       JSON.stringify({ attemptId, attempt: newAttemptNum, status: prev.status, failureReason: prev.failureReason, movedToDunning: isLastAttempt && shouldFail })]
    );

    return res.json({
      success: true,
      attempt: prev,
      retryNumber: newAttemptNum,
      movedToDunning: isLastAttempt && shouldFail,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/auto-charge/attempts", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const attempts = Array.from(chargeAttempts.values()).filter(a => a.orgId === orgId);
    return res.json({
      attempts,
      count: attempts.length,
      succeeded: attempts.filter(a => a.status === "succeeded").length,
      failed: attempts.filter(a => a.status === "failed").length,
      dunning: attempts.filter(a => a.status === "dunning").length,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/admin/auto-charge/dunning-queue", requireAdmin, async (req: Request, res: Response) => {
  try {
    const orgId = req.session.orgId!;
    const items = Array.from(dunningQueue.values()).filter(d => d.orgId === orgId);
    return res.json({ queue: items, count: items.length });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

}
