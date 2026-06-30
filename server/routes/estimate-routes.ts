import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "crypto";
import { invoices, estimates, round2 } from "@shared/schema";
import { requireAdmin, requireManagerOrAbove, publicTokenLimiter, escapeHtml, wrapEmailLayout, emailButton, emailDivider } from "./middleware";
import { sendInvoiceEmail, getSmtpConfigFromOrg, pickRecipients } from "../email";
import { generateEstimatePdf } from "../pdf";
import { fireWebhookEvent } from "../webhooks";

export function registerEstimateRoutes(app: Express) {
app.get("/api/estimates", requireManagerOrAbove, async (req, res) => {
  const list = await storage.getEstimates(req.session.orgId!);
  res.json(list);
});
app.get("/api/estimates/:id", requireManagerOrAbove, async (req, res) => {
  const est = await storage.getEstimate(req.params.id as string, req.session.orgId!);
  if (!est) return res.status(404).json({ message: "Estimate not found" });
  res.json(est);
});
app.post("/api/estimates", requireManagerOrAbove, async (req, res) => {
  const schema = z.object({
    clientId: z.string().min(1),
    issuedDate: z.string().min(1),
    expiryDate: z.string().nullable().optional(),
    discountType: z.string().default("NONE"),
    discountValue: z.coerce.number().default(0),
    taxRate: z.coerce.number().default(0),
    notes: z.string().nullable().optional(),
    lines: z.array(z.object({
      description: z.string().min(1),
      quantity: z.coerce.number().positive(),
      unitRate: z.coerce.number().nonnegative(),
    })),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const orgId = req.session.orgId!;

  const full = await db.transaction(async (tx) => {
    const number = await storage.getNextEstimateNumber(orgId);
    const est = await storage.createEstimate({
      orgId,
      clientId: parsed.data.clientId,
      number,
      issuedDate: parsed.data.issuedDate,
      expiryDate: parsed.data.expiryDate || null,
      discountType: parsed.data.discountType,
      discountValue: String(parsed.data.discountValue),
      taxRate: String(parsed.data.taxRate),
      notes: parsed.data.notes || null,
    });

    for (const line of parsed.data.lines) {
      const amount = round2(line.quantity * line.unitRate);
      await storage.createEstimateLine({
        orgId,
        estimateId: est.id,
        description: line.description,
        quantity: String(line.quantity),
        unitRate: String(line.unitRate),
        amount: String(amount),
      });
    }

    await storage.recalcEstimateTotals(est.id, orgId);

    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "ESTIMATE_CREATED",
      entityType: "estimates",
      entityId: est.id,
      details: { number },
    });

    return await storage.getEstimate(est.id, orgId);
  });

  res.status(201).json(full);
});
app.patch("/api/estimates/:id", requireManagerOrAbove, async (req, res) => {
  const schema = z.object({
    expiryDate: z.string().nullable().optional(),
    discountType: z.string().optional(),
    discountValue: z.coerce.number().optional(),
    taxRate: z.coerce.number().optional(),
    notes: z.string().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const update: any = { ...parsed.data };
  if (update.discountValue !== undefined) update.discountValue = String(update.discountValue);
  if (update.taxRate !== undefined) update.taxRate = String(update.taxRate);

  const est = await storage.updateEstimate(req.params.id as string, req.session.orgId!, update);
  if (!est) return res.status(404).json({ message: "Estimate not found" });

  await storage.recalcEstimateTotals(est.id, req.session.orgId!);

  await storage.createAuditLog({
    orgId: req.session.orgId!,
    userId: req.session.userId!,
    action: "ESTIMATE_UPDATED",
    entityType: "estimates",
    entityId: est.id,
    details: {},
  });

  const full = await storage.getEstimate(est.id, req.session.orgId!);
  res.json(full);
});
app.post("/api/estimates/:id/send", requireManagerOrAbove, async (req, res) => {
  const orgId = req.session.orgId!;
  const est = await storage.getEstimate(req.params.id as string, orgId);
  if (!est) return res.status(404).json({ message: "Estimate not found" });
  if (est.status !== "DRAFT") return res.status(400).json({ message: "Only DRAFT estimates can be sent" });

  // Resolve recipients BEFORE flipping status — parity with invoice send: never
  // mark an estimate SENT (or write an outbox row) with nobody to email it to.
  const reqBody = (req.body || {}) as Record<string, unknown>;
  const asStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  const emailTo = asStr(reqBody.emailTo);
  const emailSubject = asStr(reqBody.emailSubject);
  const emailBody = asStr(reqBody.emailBody);
  const customCc = Array.isArray(reqBody.cc) ? (reqBody.cc as unknown[]).filter((x): x is string => typeof x === "string") : undefined;
  const client = est.clientId ? await storage.getClientById(est.clientId, orgId) : null;
  const contacts = est.clientId ? await storage.getContactsByClient(est.clientId, orgId) : [];
  const billingContacts = est.clientId ? await storage.getBillingContactsByClient(est.clientId, orgId) : [];
  const recipients = pickRecipients({
    clientEmail: client?.email,
    contacts,
    billingContacts,
    override: { to: emailTo, cc: customCc },
  });
  if (!recipients.to) {
    return res.status(422).json({
      code: "NO_RECIPIENT",
      message: "This estimate has no email recipient. Add a client email or a contact with an email address, then try again.",
    });
  }
  const toEmail = recipients.to;

  const token = randomBytes(32).toString("hex");
  await storage.setEstimatePublicToken(est.id, orgId, token);
  await storage.updateEstimate(est.id, orgId, { status: "SENT" });

  const orgForEmail = await storage.getOrg(orgId);
  const orgName = orgForEmail?.name || "CherryWorks Pro";
  const baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const viewLink = `${baseUrl}/e/${token}`;
  const subject = emailSubject || `Estimate ${est.number} from ${orgName}`;
  const body = wrapEmailLayout(`
        <p style="font-size:20px;font-weight:700;color:#1a1a2e;margin:0 0 4px;">Estimate ${est.number}</p>
        <p style="font-size:14px;color:#8b8da3;margin:0 0 28px;">From ${orgName}</p>

        ${emailBody
          ? `<div style="font-size:15px;color:#555770;line-height:1.7;margin:0 0 28px;white-space:pre-wrap;">${escapeHtml(emailBody).replace(/\n/g, "<br>")}</div>`
          : `<p style="font-size:15px;color:#555770;line-height:1.7;margin:0 0 28px;">
          Please review the estimate below. You can approve or decline it directly from the link.
        </p>`}

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center">${emailButton("View Estimate", viewLink)}</td></tr>
        </table>

        ${emailDivider()}
        <p style="font-size:14px;color:#555770;margin:0;">Thank you for your consideration.</p>
      `, { orgName, preheader: `Estimate ${est.number} from ${orgName}` });

  const outboxEmail = await storage.createOutboxEmail({
    orgId,
    estimateId: est.id,
    toEmail,
    cc: recipients.cc.length > 0 ? recipients.cc.join(", ") : null,
    subject,
    body,
    status: "PENDING",
  });

  let emailSent = false;
  let emailError: string | null = null;
  try {
    const smtpConfig = getSmtpConfigFromOrg(orgForEmail);
    const sendResult = await sendInvoiceEmail(toEmail, subject, body, undefined, smtpConfig, recipients.cc.length > 0 ? recipients.cc : undefined, orgForEmail);
    await storage.updateOutboxEmailStatus(outboxEmail.id, "SENT", undefined, sendResult.messageId);
    emailSent = true;
  } catch (smtpErr: any) {
    emailError = smtpErr.message;
    await storage.updateOutboxEmailStatus(outboxEmail.id, "FAILED", smtpErr.message);
    console.error("[estimate-send] Email failed:", smtpErr.message);
  }

  await storage.createAuditLog({
    orgId,
    userId: req.session.userId!,
    action: "ESTIMATE_SENT",
    entityType: "estimates",
    entityId: est.id,
    details: { publicToken: token, emailTo: toEmail, emailSent, recipientSource: recipients.source },
  });

  fireWebhookEvent(orgId, "estimate.sent", { id: est.id, number: est.number, clientId: est.clientId, status: "SENT" });

  res.json({ ok: true, publicToken: token, emailSent, toEmail, cc: recipients.cc, emailError });
});
app.post("/api/estimates/:id/accept", requireManagerOrAbove, async (req, res) => {
  const est = await storage.getEstimate(req.params.id as string, req.session.orgId!);
  if (!est) return res.status(404).json({ message: "Estimate not found" });
  if (est.status !== "SENT") return res.status(400).json({ message: "Only SENT estimates can be accepted" });

  await storage.updateEstimate(est.id, req.session.orgId!, { status: "ACCEPTED" });

  await storage.createAuditLog({
    orgId: req.session.orgId!,
    userId: req.session.userId!,
    action: "ESTIMATE_ACCEPTED",
    entityType: "estimates",
    entityId: est.id,
    details: {},
  });

  res.json({ ok: true });
});
app.post("/api/estimates/:id/decline", requireManagerOrAbove, async (req, res) => {
  const est = await storage.getEstimate(req.params.id as string, req.session.orgId!);
  if (!est) return res.status(404).json({ message: "Estimate not found" });
  if (est.status !== "SENT") return res.status(400).json({ message: "Only SENT estimates can be declined" });

  await storage.updateEstimate(est.id, req.session.orgId!, { status: "DECLINED" });

  await storage.createAuditLog({
    orgId: req.session.orgId!,
    userId: req.session.userId!,
    action: "ESTIMATE_DECLINED",
    entityType: "estimates",
    entityId: est.id,
    details: {},
  });

  res.json({ ok: true });
});
app.get("/api/estimates/:id/conversion-preview", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const est = await storage.getEstimate(req.params.id as string, orgId);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (est.status !== "ACCEPTED") return res.status(400).json({ message: "Only ACCEPTED estimates can be previewed for conversion" });

    const org = await storage.getOrg(orgId);
    const invoiceNumber = await storage.getNextInvoiceNumber(orgId);
    const today = new Date().toISOString().split("T")[0];
    const defaultTerms = org?.defaultPaymentTermsDays || 30;
    const dueDate = new Date(Date.now() + defaultTerms * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const estLines = (est as any).lines || [];

    res.json({
      estimateId: est.id,
      estimateNumber: est.number,
      clientId: est.clientId,
      invoiceNumber,
      issuedDate: today,
      dueDate,
      paymentTermsDays: defaultTerms,
      lines: estLines,
      subtotal: est.subtotal,
      discountType: est.discountType || "NONE",
      discountValue: est.discountValue || "0",
      discountAmount: est.discountAmount || "0",
      taxRate: est.taxRate || "0",
      taxAmount: est.taxAmount || "0",
      total: est.total,
      notes: est.notes,
    });
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});

app.post("/api/estimates/:id/convert-to-invoice", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const est = await storage.getEstimate(req.params.id as string, orgId);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (est.status !== "ACCEPTED") return res.status(400).json({ message: "Only ACCEPTED estimates can be converted to invoices" });

    const org = await storage.getOrg(orgId);
    const invoiceNumber = await storage.getNextInvoiceNumber(orgId);
    const today = new Date().toISOString().split("T")[0];
    const defaultTerms = org?.defaultPaymentTermsDays || 30;
    const dueDate = new Date(Date.now() + defaultTerms * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const estLines = (est as any).lines || [];

    const estimateSnapshot = {
      estimateId: est.id,
      estimateNumber: est.number,
      estimateStatus: est.status,
      estimateTotal: est.total,
      estimateSubtotal: est.subtotal,
      estimateIssuedDate: est.issuedDate,
      estimateExpiryDate: est.expiryDate,
      estimateLines: estLines,
      convertedAt: new Date().toISOString(),
      frozenOriginal: true,
    };
    const notesWithSnapshot = [
      est.notes || "",
      `\n[Converted from Estimate ${est.number}]`,
    ].join("").trim();

    const invoice = await storage.createInvoice({
      orgId,
      clientId: est.clientId,
      number: invoiceNumber,
      status: "DRAFT",
      issuedDate: today,
      dueDate,
      notes: notesWithSnapshot,
      discountType: est.discountType || "NONE",
      discountValue: est.discountValue || "0",
      taxRate: est.taxRate || "0",
      sourceEstimateId: est.id,
    });

    for (const line of estLines) {
      await storage.createInvoiceLine({
        orgId,
        invoiceId: invoice.id,
        description: line.description,
        quantity: line.quantity,
        unitRate: line.unitRate,
        amount: line.amount,
      });
    }

    await storage.updateInvoiceTotal(invoice.id, orgId);

    await db.update(estimates).set({ status: "INVOICED" }).where(eq(estimates.id, est.id));

    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "ESTIMATE_CONVERTED_TO_INVOICE",
      entityType: "invoice",
      entityId: invoice.id,
      details: { estimateId: est.id, estimateNumber: est.number, invoiceNumber, estimateSnapshot },
    });

    fireWebhookEvent(orgId, "invoice.created", { id: invoice.id, number: invoiceNumber, clientId: est.clientId, status: "DRAFT", source: "estimate_conversion" });

    const result = await storage.getInvoice(invoice.id, orgId);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});
app.post("/api/estimates/:id/duplicate", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const est = await storage.getEstimate(req.params.id as string, orgId);
    if (!est) return res.status(404).json({ message: "Estimate not found" });

    const estimateNumber = await storage.getNextEstimateNumber(orgId);
    const today = new Date().toISOString().split("T")[0];
    const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const newEst = await storage.createEstimate({
      orgId,
      clientId: est.clientId,
      number: estimateNumber,
      status: "DRAFT",
      issuedDate: today,
      expiryDate,
      notes: est.notes,
      discountType: est.discountType || "NONE",
      discountValue: est.discountValue || "0",
      taxRate: est.taxRate || "0",
    });

    const lines = (est as any).lines || [];
    for (const line of lines) {
      await storage.createEstimateLine({
        orgId,
        estimateId: newEst.id,
        description: line.description,
        quantity: line.quantity,
        unitRate: line.unitRate,
        amount: line.amount,
      });
    }

    await storage.recalcEstimateTotals(newEst.id, orgId);

    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "ESTIMATE_DUPLICATED",
      entityType: "estimates",
      entityId: newEst.id,
      details: { sourceEstimateId: est.id },
    });

    const full = await storage.getEstimate(newEst.id, orgId);
    res.status(201).json(full);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});
app.post("/api/estimates/:id/lines", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const est = await storage.getEstimate(req.params.id as string, orgId);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (est.status !== "DRAFT") return res.status(400).json({ message: "Can only edit DRAFT estimate lines" });

    const { description, quantity, unitRate } = req.body;
    if (quantity === undefined || quantity === null) return res.status(400).json({ message: "quantity is required" });
    if (unitRate === undefined || unitRate === null) return res.status(400).json({ message: "unitRate is required" });
    const qty = Number(quantity);
    const rate = Number(unitRate);
    if (isNaN(qty) || qty <= 0) return res.status(400).json({ message: "quantity must be a positive number" });
    if (isNaN(rate) || rate < 0) return res.status(400).json({ message: "unitRate must be >= 0" });
    const amount = round2(qty * rate);

    const line = await storage.createEstimateLine({
      orgId,
      estimateId: est.id,
      description: description || "Service",
      quantity: String(qty),
      unitRate: String(rate),
      amount: amount.toFixed(2),
    });

    await storage.recalcEstimateTotals(est.id, orgId);
    const full = await storage.getEstimate(est.id, orgId);
    res.json({ line, estimate: full });
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});
app.put("/api/estimates/:id/lines/:lineId", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const est = await storage.getEstimate(req.params.id as string, orgId);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (est.status !== "DRAFT") return res.status(400).json({ message: "Can only edit DRAFT estimate lines" });

    const { description, quantity, unitRate } = req.body;
    if (quantity === undefined || quantity === null) return res.status(400).json({ message: "quantity is required" });
    if (unitRate === undefined || unitRate === null) return res.status(400).json({ message: "unitRate is required" });
    const qty = Number(quantity);
    const rate = Number(unitRate);
    if (isNaN(qty) || qty <= 0) return res.status(400).json({ message: "quantity must be a positive number" });
    if (isNaN(rate) || rate < 0) return res.status(400).json({ message: "unitRate must be >= 0" });
    const amount = round2(qty * rate);

    await storage.updateEstimateLine(req.params.lineId as string, orgId, {
      description,
      quantity: String(qty),
      unitRate: String(rate),
      amount: amount.toFixed(2),
    });

    await storage.recalcEstimateTotals(est.id, orgId);
    const full = await storage.getEstimate(est.id, orgId);
    res.json(full);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});
app.delete("/api/estimates/:id/lines/:lineId", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const est = await storage.getEstimate(req.params.id as string, orgId);
    if (!est) return res.status(404).json({ message: "Estimate not found" });
    if (est.status !== "DRAFT") return res.status(400).json({ message: "Can only edit DRAFT estimate lines" });

    await storage.deleteEstimateLine(req.params.lineId as string, orgId);
    await storage.recalcEstimateTotals(est.id, orgId);
    const full = await storage.getEstimate(est.id, orgId);
    res.json(full);
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});
app.delete("/api/estimates/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const est = await storage.getEstimate(req.params.id as string, orgId);
    if (!est) return res.status(404).json({ message: "Estimate not found" });

    await storage.deleteEstimate(est.id, orgId);

    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "ESTIMATE_DELETED",
      entityType: "estimates",
      entityId: est.id,
      details: { number: est.number },
    });

    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});
app.get("/api/estimates/:id/pdf", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const estimate = await storage.getEstimate(req.params.id as string, orgId);
    if (!estimate) return res.status(404).json({ message: "Estimate not found" });

    const { generateEstimatePdf } = await import("../pdf");
    const orgData = await storage.getOrg(orgId);
    const pdfBuffer = await generateEstimatePdf(estimate as any, orgData);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${estimate.number}.pdf"`);
    return res.send(pdfBuffer);
  } catch (err: any) {
    console.error("Estimate PDF generation error:", err);
    return res.status(500).json({ message: "PDF generation failed" });
  }
});
app.get("/api/public/estimates/:token", publicTokenLimiter, async (req, res) => {
  const est = await storage.getEstimateByPublicToken(req.params.token as string);
  if (!est) return res.status(404).json({ message: "Estimate not found" });
  res.json(est);
});
app.post("/api/public/estimates/:token/accept", publicTokenLimiter, async (req, res) => {
  const est = await storage.getEstimateByPublicToken(req.params.token as string);
  if (!est) return res.status(404).json({ message: "Estimate not found" });
  if (est.status !== "SENT") return res.status(400).json({ message: "Estimate cannot be accepted in current state" });

  await storage.updateEstimate(est.id, est.orgId, { status: "ACCEPTED" });
  res.json({ ok: true });
});
app.post("/api/public/estimates/:token/decline", publicTokenLimiter, async (req, res) => {
  const est = await storage.getEstimateByPublicToken(req.params.token as string);
  if (!est) return res.status(404).json({ message: "Estimate not found" });
  if (est.status !== "SENT") return res.status(400).json({ message: "Estimate cannot be declined in current state" });

  await storage.updateEstimate(est.id, est.orgId, { status: "DECLINED" });
  res.json({ ok: true });
});
}
