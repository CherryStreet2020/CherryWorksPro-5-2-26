import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { payments, invoices, createPaymentSchema, round2 } from "@shared/schema";
import { sanitizeErrorMessage, requireAdmin, requireManagerOrAbove, createAutoJournalEntry, isGlPosted, reverseGLBySourceRef } from "./middleware";
import { fireWebhookEvent } from "../webhooks";

export function registerPaymentRoutes(app: Express) {
app.get("/api/payments", requireManagerOrAbove, async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const pageSize = Math.min(req.query.pageSize ? Number(req.query.pageSize) : 25, 200);
  const result = await storage.getPaymentsByOrg(req.session.orgId!, { page, pageSize });
  return res.json(result);
});
app.post("/api/payments", requireManagerOrAbove, async (req, res) => {
  try {
    const parsed = createPaymentSchema.parse(req.body);
    const orgId = req.session.orgId!;

    const [invoice] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, parsed.invoiceId), eq(invoices.orgId, orgId)));

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }
    if (invoice.status === "DRAFT") {
      return res.status(400).json({ message: "Cannot record payment for a draft invoice" });
    }
    if (invoice.status === "PAID") {
      return res.status(400).json({ message: "Invoice is already fully paid" });
    }
    if (invoice.status === "VOID") {
      return res.status(400).json({ message: "Cannot record payment for a voided invoice" });
    }

    const outstanding = round2(Number(invoice.total) - Number(invoice.paidAmount));
    if (round2(parsed.amount) > outstanding) {
      return res.status(400).json({ message: `Payment amount ($${parsed.amount.toFixed(2)}) exceeds outstanding balance ($${outstanding.toFixed(2)})` });
    }

    const payment = await storage.createPayment({
      orgId,
      invoiceId: parsed.invoiceId,
      amount: parsed.amount.toFixed(2),
      currency: (invoice as any)?.currency || "USD",
      date: parsed.date,
      method: parsed.method,
      referenceNumber: parsed.referenceNumber || null,
      notes: parsed.notes || null,
    });

    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "PAYMENT_RECORDED",
      entityType: "payment",
      entityId: payment.id,
      details: { amount: parsed.amount, invoiceId: parsed.invoiceId },
    });

    await storage.createClientActivity({
      orgId,
      clientId: invoice.clientId,
      userId: req.session.userId!,
      type: "PAYMENT_RECORDED",
      title: `Payment of ${Number(parsed.amount).toFixed(2)} ${invoice.currency || "USD"} recorded`,
      description: `Invoice ${invoice.number} • ${parsed.method}`,
      linkUrl: `/invoices/${invoice.id}`,
      metadata: { paymentId: payment.id, invoiceId: invoice.id, amount: parsed.amount, method: parsed.method },
    });

    fireWebhookEvent(orgId, "payment.received", { id: payment.id, invoiceId: parsed.invoiceId, amount: parsed.amount, method: parsed.method, date: parsed.date });

    const updatedInvoice = await storage.getInvoice(parsed.invoiceId, orgId);
    if (updatedInvoice && updatedInvoice.status === "PAID") {
      fireWebhookEvent(orgId, "invoice.paid", { id: updatedInvoice.id, number: updatedInvoice.number, clientId: updatedInvoice.clientId, total: updatedInvoice.total, paidAmount: updatedInvoice.paidAmount });
    }

    {
      const xr = Number(invoice.exchangeRate) || 1;
      const basePmt = round2(parsed.amount * xr);
      const pmtAmt = basePmt.toFixed(2);
      const currSuffix = invoice.currency && invoice.currency !== "USD" ? ` (${invoice.currency})` : "";
      const glLines: { accountNumber: string; debit: string; credit: string; memo?: string }[] = [
        { accountNumber: "1000", debit: pmtAmt, credit: "0.00", memo: "Cash received" },
        { accountNumber: "1200", debit: "0.00", credit: pmtAmt, memo: "Accounts Receivable reduced" },
      ];
      await createAutoJournalEntry(orgId, parsed.date, `Payment on Invoice ${invoice.number}${currSuffix}`, "PAYMENT", payment.id, glLines, req.session.userId);
    }

    return res.json(payment);
  } catch (err: any) {
    if (err.name === "ZodError" && err.issues) {
      const messages = err.issues.map((i: any) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return res.status(400).json({ message: messages });
    }
    const sc = (err as any).statusCode;
    if (sc && sc >= 400 && sc < 500) {
      return res.status(sc).json({ message: err.message });
    }
    console.error("[payments] POST error:", err);
    return res.status(500).json({ message: "An error occurred while recording the payment" });
  }
});
app.patch("/api/payments/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const { date, method, notes, referenceNumber, status } = req.body;
    if (status !== undefined) {
      const validStatuses = ["PENDING", "CLEARED", "RECONCILED", "VOIDED", "REFUNDED"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid payment status. Must be one of: " + validStatuses.join(", ") });
      }
    }
    const payment = await storage.updatePayment(req.params.id as string, req.session.orgId!, {
      ...(date !== undefined && { date: String(date) }),
      ...(method !== undefined && { method }),
      ...(notes !== undefined && { notes }),
      ...(referenceNumber !== undefined && { referenceNumber }),
      ...(status !== undefined && { status }),
    });
    if (!payment) return res.status(404).json({ message: "Payment not found" });
    return res.json(payment);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.patch("/api/payments/:id/status", requireManagerOrAbove, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ["PENDING", "CLEARED", "RECONCILED", "VOIDED", "REFUNDED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }
    const payment = await storage.updatePayment(req.params.id as string, req.session.orgId!, { status });
    if (!payment) return res.status(404).json({ message: "Payment not found" });
    const auditAction = status === "VOIDED" ? "PAYMENT_VOIDED" : "PAYMENT_STATUS_UPDATED";
    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: auditAction,
      entityType: "payment",
      entityId: payment.id,
      details: { status, invoiceId: payment.invoiceId, amount: payment.amount },
    });
    return res.json(payment);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.delete("/api/payments/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const payment = await storage.getPayment(req.params.id as string, orgId);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    await reverseGLBySourceRef(
      orgId, "PAYMENT", payment.id,
      `Reversal: Payment ${payment.id} deleted`,
      "PAYMENT_DELETE", req.session.userId!,
    );

    const deleted = await storage.deletePayment(req.params.id as string, orgId);
    if (!deleted) return res.status(404).json({ message: "Payment not found" });
    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "PAYMENT_DELETED",
      entityType: "payment",
      entityId: req.params.id as string,
      details: { amount: payment.amount, invoiceId: payment.invoiceId, method: payment.method },
    });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/payments/:id/refund", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;

    const payment = await storage.getPayment(req.params.id as string, orgId);
    if (!payment) return res.status(404).json({ message: "Payment not found" });
    if (payment.provider !== "MANUAL") return res.status(400).json({ message: "Cannot refund Stripe payment — use Stripe dashboard" });

    const refundAmount = Number(req.body?.amount ?? payment.amount ?? 0);
    if (isNaN(refundAmount) || refundAmount <= 0) {
      return res.status(400).json({ message: "Refund amount must be a positive number" });
    }

    const currentUser = await storage.getUserById(req.session.userId!);
    if (refundAmount >= 500 && currentUser?.role !== "ADMIN") {
      return res.status(403).json({
        message: "Refunds of $500 or more require an Admin. Please ask an Admin to process this refund."
      });
    }

    const refundData = {
      orgId,
      invoiceId: payment.invoiceId,
      amount: (-Math.abs(refundAmount)).toFixed(2),
      date: new Date().toISOString().split("T")[0],
      method: payment.method,
      provider: "MANUAL" as any,
      notes: `Refund of ${payment.method} payment $${Math.abs(refundAmount).toFixed(2)} (original payment ${req.params.id})`,
    };

    const result = await storage.createRefundPaymentAtomic(refundData, payment.invoiceId, orgId, refundAmount);
    if (!result.success) {
      const msgs: Record<string, string> = {
        INVOICE_NOT_FOUND: "Associated invoice not found",
        REFUND_EXCEEDS_PAID: "Refund amount exceeds remaining refundable balance",
      };
      return res.status(400).json({ message: msgs[result.reason!] || result.reason });
    }

    await storage.recomputeInvoicePaidStatus(payment.invoiceId, orgId);

    const invoice = await storage.getInvoice(payment.invoiceId, orgId);
    const xr = invoice ? (Number(invoice.exchangeRate) || 1) : 1;
    const baseRefund = round2(refundAmount * xr);
    const refAmt = baseRefund.toFixed(2);
    const refundMemo = `Refund $${refundAmount.toFixed(2)} on Payment ${req.params.id}`;
    const refSourceRef = `${req.params.id}-refund-${result.payment!.id}`;
    await createAutoJournalEntry(orgId, new Date().toISOString().split("T")[0], refundMemo, "PAYMENT_REFUND", refSourceRef, [
      { accountNumber: "1200", debit: refAmt, credit: "0.00", memo: "AR restored (refund)" },
      { accountNumber: "1000", debit: "0.00", credit: refAmt, memo: "Cash returned (refund)" },
    ], req.session.userId);

    const updatedInvoice = await storage.getInvoice(payment.invoiceId, orgId);

    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "PAYMENT_REFUNDED",
      entityType: "payment",
      entityId: result.payment!.id,
      details: { originalPaymentId: req.params.id, invoiceId: payment.invoiceId, amount: result.payment!.amount },
    });
    return res.json({ refund: result.payment, invoice: updatedInvoice });
  } catch (err: any) {
    return res.status(err.statusCode || 500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/payments/:id/post-gl", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const payment = await storage.getPayment(req.params.id as string, orgId);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    await storage.seedDefaultGLAccounts(orgId);

    if (await isGlPosted(orgId, "PAYMENT", payment.id)) {
      return res.status(400).json({ message: "Payment already posted to GL" });
    }

    const invoice = await storage.getInvoice(payment.invoiceId, orgId);
    const xr = invoice ? (Number(invoice.exchangeRate) || 1) : 1;
    const basePmt = round2(Number(payment.amount) * xr);
    const pmtAmt = basePmt.toFixed(2);
    const currSuffix = invoice?.currency && invoice.currency !== "USD" ? ` (${invoice.currency})` : "";
    const label = invoice ? `Payment on Invoice ${invoice.number}${currSuffix}` : "Payment received";
    await createAutoJournalEntry(orgId, payment.date, label, "PAYMENT", payment.id, [
      { accountNumber: "1000", debit: pmtAmt, credit: "0.00", memo: "Cash received" },
      { accountNumber: "1200", debit: "0.00", credit: pmtAmt, memo: "Accounts Receivable reduced" },
    ], req.session.userId);

    return res.json({ ok: true, message: `Payment of $${pmtAmt} posted to GL` });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
}
