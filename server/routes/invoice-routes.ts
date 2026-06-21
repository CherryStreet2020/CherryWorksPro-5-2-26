import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db, pool } from "../db";
import { eq, desc, and, gte } from "drizzle-orm";
import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { invoiceLines, invoices, payments, projectMembers, timeEntries, glJournalEntries, generateInvoiceSchema, addInvoiceLineSchema, updateInvoiceLineSchema, updateInvoiceSchema, round2 } from "@shared/schema";
import { sanitizeErrorMessage, requireAdmin, requireManagerOrAbove, publicTokenLimiter, EDITABLE_STATUSES, buildInvoiceSnapshot, saveRevisionIfNeeded, createAutoJournalEntry, isGlPosted, buildInvoiceEmailHtml } from "./middleware";
import { sendInvoiceEmail, getSmtpConfigFromOrg } from "../email";
import { generateInvoicePdf } from "../pdf";
import { fireWebhookEvent } from "../webhooks";
import { getExchangeRate } from "../exchange-rates";

export function registerInvoiceRoutes(app: Express) {
app.get("/api/invoices", requireManagerOrAbove, async (req, res) => {
  const page = req.query.page ? Number(req.query.page) : undefined;
  const pageSize = Math.min(req.query.pageSize ? Number(req.query.pageSize) : 100, 200);
  const result = await storage.getInvoicesByOrg(req.session.orgId!, { page, pageSize });
  const stripToken = (inv: any) => { const { publicToken, ...rest } = inv; return rest; };
  const stripped = Array.isArray(result)
    ? result.map(stripToken)
    : { ...(result as any), data: (result as any).data?.map(stripToken) };
  const totalCount = await storage.getInvoiceCount(req.session.orgId!);
  res.setHeader("X-Total-Count", totalCount);
  return res.json(stripped);
});
app.get("/api/invoices/unpaid", requireManagerOrAbove, async (req, res) => {
  const result = await storage.getUnpaidInvoices(req.session.orgId!);
  return res.json(result);
});

async function createGroupedInvoiceLines(
  invoiceId: string,
  orgId: string,
  entries: { entry: any; projectName: string; userName: string; serviceName: string | null }[],
  lineGroupBy: "team-member" | "project" | "service" | "none",
) {
  type AggLine = { description: string; minutes: number; rate: number; entryIds: string[]; groupKey: string };

  const getGroupKey = (row: typeof entries[0]) => {
    switch (lineGroupBy) {
      case "team-member": return row.entry.userId;
      case "project": return row.entry.projectId;
      case "service": return row.entry.serviceId || "__no_service__";
      case "none": return "__flat__";
    }
  };

  const getGroupLabel = (row: typeof entries[0]) => {
    switch (lineGroupBy) {
      case "team-member": return row.userName;
      case "project": return row.projectName;
      case "service": return row.serviceName || "General";
      case "none": return "";
    }
  };

  const getLineDescription = (row: typeof entries[0], hours: number) => {
    switch (lineGroupBy) {
      case "team-member":
        return `${row.serviceName || row.projectName} (${hours.toFixed(1)}h)`;
      case "project":
        return `${row.userName} - ${row.serviceName || "General"} (${hours.toFixed(1)}h)`;
      case "service":
        return `${row.userName} - ${row.projectName} (${hours.toFixed(1)}h)`;
      case "none":
        return `${row.projectName} - ${row.userName} (${hours.toFixed(1)}h)`;
    }
  };

  const groups: Record<string, { label: string; subGroups: Record<string, AggLine & { firstRow: typeof entries[0] }> }> = {};

  for (const row of entries) {
    const gKey = getGroupKey(row);
    const gLabel = getGroupLabel(row);
    if (!groups[gKey]) groups[gKey] = { label: gLabel, subGroups: {} };

    const subKey = lineGroupBy === "none"
      ? `${row.entry.projectId}-${row.entry.userId}-${row.entry.rate}`
      : `${row.entry.projectId}-${row.entry.userId}-${row.entry.serviceId || ""}-${row.entry.rate}`;

    if (!groups[gKey].subGroups[subKey]) {
      groups[gKey].subGroups[subKey] = {
        description: "",
        minutes: 0,
        rate: Number(row.entry.rate),
        entryIds: [],
        groupKey: gKey,
        firstRow: row,
      };
    }
    groups[gKey].subGroups[subKey].minutes += row.entry.minutes;
    groups[gKey].subGroups[subKey].entryIds.push(row.entry.id);
  }

  let sortOrder = 0;
  for (const group of Object.values(groups)) {
    if (lineGroupBy !== "none") {
      await storage.createInvoiceLine({
        orgId,
        invoiceId,
        description: group.label,
        quantity: "0",
        unitRate: "0",
        amount: "0",
        sortOrder,
        isHeader: true,
      });
      sortOrder++;
    }

    for (const sub of Object.values(group.subGroups)) {
      const hours = sub.minutes / 60;
      const amount = round2(hours * sub.rate);
      const desc = getLineDescription(sub.firstRow, hours);

      const line = await storage.createInvoiceLine({
        orgId,
        invoiceId,
        description: desc,
        quantity: hours.toFixed(2),
        unitRate: sub.rate.toFixed(2),
        amount: amount.toFixed(2),
        sortOrder,
        isHeader: false,
      });
      sortOrder++;

      await storage.markTimeEntriesInvoiced(sub.entryIds, line.id, orgId);
    }
  }
}

app.post("/api/invoices", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;

    const org = await storage.getOrg(orgId);
    if ((org?.planTier || "TRIAL") === "STARTER") {
      const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const recentInvoices = await db.select().from(invoices).where(and(
        eq(invoices.orgId, orgId),
        gte(invoices.createdAt, oneYearAgo),
      ));
      if (recentInvoices.length >= 50) {
        await storage.createAuditLog({
          orgId,
          userId: req.session.userId!,
          action: "FEATURE_GATE_BLOCKED",
          entityType: "feature_gate",
          entityId: "invoice_annual_limit",
          details: { feature: "Annual Invoice Limit", currentCount: recentInvoices.length, maxAllowed: 50, currentTier: "STARTER" },
        });
        return res.status(403).json({
          message: "Starter plan supports up to 50 invoices per year. Upgrade to Professional for unlimited invoices.",
          currentCount: recentInvoices.length,
          invoiceLimit: 50,
          upgradeUrl: "/pricing",
        });
      }
    }

    const schema = z.object({
      clientId: z.string().min(1),
      projectId: z.string().optional(),
      issuedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
      currency: z.string().length(3, "Must be 3-letter currency code").default("USD"),
      notes: z.string().nullable().optional(),
      lines: z.array(z.any()).optional(),
      status: z.literal("DRAFT").optional(),
    });
    const parsed = schema.parse(req.body);

    const rawTotal = Number(req.body?.total) || 0;
    const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    if (rawTotal > 0 && rawLines.length === 0) {
      return res.status(400).json({ message: "Cannot save an invoice with a total greater than zero and no line items" });
    }

    const client = await storage.getClientById(parsed.clientId, orgId);
    if (!client) return res.status(400).json({ message: "Client not found in your organization" });

    const orgForCurrency = org || await storage.getOrg(orgId);
    const baseCurrency = orgForCurrency?.baseCurrency || "USD";
    let exchangeRate = "1";
    if (parsed.currency !== baseCurrency) {
      const rateResult = await getExchangeRate(baseCurrency, parsed.currency, orgId);
      if (rateResult.rate === 0) {
        return res.status(503).json({ message: `Exchange rate unavailable for ${baseCurrency}→${parsed.currency}.` });
      }
      exchangeRate = rateResult.rateStr;
    }

    const invoiceNumber = await storage.getNextInvoiceNumber(orgId);
    const invoice = await storage.createInvoice({
      orgId,
      clientId: parsed.clientId,
      number: invoiceNumber,
      status: "DRAFT",
      issuedDate: parsed.issuedDate,
      dueDate: parsed.dueDate,
      notes: parsed.notes || null,
      discountType: "NONE",
      discountValue: "0",
      taxRate: org?.defaultTaxRate || "0",
      currency: parsed.currency,
      exchangeRate,
    });

    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "INVOICE_CREATED",
      entityType: "invoice",
      entityId: invoice.id,
      details: { number: invoiceNumber, blank: true },
    });

    await storage.createClientActivity({
      orgId,
      clientId: parsed.clientId,
      userId: req.session.userId!,
      type: "INVOICE_CREATED",
      title: `Invoice ${invoiceNumber} created`,
      description: null,
      linkUrl: `/invoices/${invoice.id}`,
      metadata: { invoiceId: invoice.id, number: invoiceNumber },
    });

    const result = await storage.getInvoice(invoice.id, orgId);
    fireWebhookEvent(orgId, "invoice.created", { id: invoice.id, number: invoiceNumber, clientId: parsed.clientId, status: "DRAFT" });
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post(
  "/api/invoices/generate",
  requireManagerOrAbove,
  async (req, res) => {
    try {
      const parsed = generateInvoiceSchema.parse(req.body);
      const orgId = req.session.orgId!;
      const includeUnapproved = parsed.includeUnapproved === true;

      const client = await storage.getClientById(parsed.clientId, orgId);
      if (!client) {
        return res.status(400).json({ message: "Client not found in your organization" });
      }

      let unbilled;
      if (includeUnapproved) {
        unbilled = await storage.getUnbilledTimeForClient(orgId, parsed.clientId);
        const approvedEntries = await storage.getUnbilledApprovedTimeForClient(orgId, parsed.clientId);
        const unapprovedCount = unbilled.length - approvedEntries.length;

        if (unapprovedCount > 0) {
          await storage.createAuditLog({
            orgId,
            userId: req.session.userId!,
            action: "INVOICE_GENERATE_OVERRIDE_UNAPPROVED",
            entityType: "invoice",
            entityId: "",
            details: {
              clientId: parsed.clientId,
              totalEntries: unbilled.length,
              unapprovedEntries: unapprovedCount,
              approvedEntries: approvedEntries.length,
            },
          });
        }
      } else {
        unbilled = await storage.getUnbilledApprovedTimeForClient(orgId, parsed.clientId);
      }

      if (parsed.teamMemberIds && parsed.teamMemberIds.length > 0) {
        unbilled = unbilled.filter((row: any) => parsed.teamMemberIds!.includes(row.entry.userId));
      }
      if (parsed.dateFrom) {
        unbilled = unbilled.filter((row: any) => row.entry.date >= parsed.dateFrom!);
      }
      if (parsed.dateTo) {
        unbilled = unbilled.filter((row: any) => row.entry.date <= parsed.dateTo!);
      }

      if (!unbilled.length) {
        if (!includeUnapproved) {
          const allUnbilled = await storage.getUnbilledTimeForClient(orgId, parsed.clientId);
          if (allUnbilled.length > 0) {
            return res.status(400).json({
              message: `No approved unbilled time entries found. There are ${allUnbilled.length} unapproved entries — enable "Include unapproved time" to include them.`,
            });
          }
        }
        return res
          .status(400)
          .json({ message: "No unbilled time entries for this client" });
      }

      const today = new Date().toISOString().split("T")[0];
      const org = await storage.getOrg(orgId);
      const defaultTerms = org?.defaultPaymentTermsDays || 30;
      const defaultTax = org?.defaultTaxRate || "0";
      const dueDate = parsed.dueDate ||
        new Date(Date.now() + defaultTerms * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

      const baseCurrency = org?.baseCurrency || "USD";
      const invoiceCurrency = parsed.currency || client.currency || baseCurrency;
      let clientExchangeRate = "1";
      if (parsed.currency && parsed.exchangeRate) {
        const rate = Number(parsed.exchangeRate);
        if (rate <= 0) return res.status(400).json({ message: "Exchange rate must be greater than 0" });
        clientExchangeRate = invoiceCurrency === baseCurrency ? "1" : parsed.exchangeRate;
      } else if (invoiceCurrency !== baseCurrency) {
        const rateResult = await getExchangeRate(baseCurrency, invoiceCurrency, req.session.orgId!);
        if (rateResult.rate === 0) {
          return res.status(503).json({ message: `Exchange rate unavailable for ${baseCurrency}→${invoiceCurrency}. Please try again or enter the rate manually.` });
        }
        clientExchangeRate = rateResult.rateStr;
      }

      if (parsed.grouping === "per-team-member") {
        const byTeamMember: Record<string, typeof unbilled> = {};
        for (const row of unbilled) {
          const cId = row.entry.userId;
          if (!byTeamMember[cId]) byTeamMember[cId] = [];
          byTeamMember[cId].push(row);
        }

        const createdInvoices: any[] = [];

        for (const [, teamMemberEntries] of Object.entries(byTeamMember)) {
          const invoiceNumber = await storage.getNextInvoiceNumber(orgId);
          const invoice = await storage.createInvoice({
            orgId,
            clientId: parsed.clientId,
            number: invoiceNumber,
            status: "DRAFT",
            issuedDate: today,
            dueDate,
            notes: null,
            discountType: "NONE",
            discountValue: "0",
            taxRate: defaultTax,
            currency: invoiceCurrency,
            exchangeRate: clientExchangeRate,
          });

          await db.transaction(async () => {
            await createGroupedInvoiceLines(invoice.id, orgId, teamMemberEntries, parsed.lineGroupBy || "team-member");
            await storage.updateInvoiceTotal(invoice.id, orgId);
            await storage.createAuditLog({
              orgId,
              userId: req.session.userId!,
              action: "INVOICE_CREATED",
              entityType: "invoice",
              entityId: invoice.id,
              details: { number: invoiceNumber },
            });
          });

          const result = await storage.getInvoice(invoice.id, orgId);
          createdInvoices.push(result);
          fireWebhookEvent(orgId, "invoice.created", { id: invoice.id, number: invoiceNumber, clientId: parsed.clientId, status: "DRAFT" });
        }

        return res.json(createdInvoices);
      }

      const invoiceNumber = await storage.getNextInvoiceNumber(orgId);

      const invoice = await storage.createInvoice({
        orgId,
        clientId: parsed.clientId,
        number: invoiceNumber,
        status: "DRAFT",
        issuedDate: today,
        dueDate,
        notes: null,
        discountType: "NONE",
        discountValue: "0",
        taxRate: defaultTax,
        currency: invoiceCurrency,
        exchangeRate: clientExchangeRate,
      });

      await db.transaction(async () => {
        await createGroupedInvoiceLines(invoice.id, orgId, unbilled, parsed.lineGroupBy || "team-member");
        await storage.updateInvoiceTotal(invoice.id, orgId);
        await storage.createAuditLog({
          orgId,
          userId: req.session.userId!,
          action: "INVOICE_CREATED",
          entityType: "invoice",
          entityId: invoice.id,
          details: { number: invoiceNumber },
        });
      });

      const result = await storage.getInvoice(invoice.id, orgId);
      fireWebhookEvent(orgId, "invoice.created", { id: invoice.id, number: invoiceNumber, clientId: parsed.clientId, status: "DRAFT" });
      return res.json(result);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  },
);

app.post(
  "/api/invoices/:id/lines",
  requireManagerOrAbove,
  async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const invoice = await storage.getInvoice(req.params.id as string, orgId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      if (!EDITABLE_STATUSES.includes(invoice.status)) {
        return res.status(400).json({ message: "Cannot edit this invoice" });
      }

      const parsed = addInvoiceLineSchema.parse(req.body);
      const amount = round2(parsed.quantity * parsed.unitRate);

      await saveRevisionIfNeeded(invoice.id, orgId, "Line item added");
      await storage.createAuditLog({ orgId, userId: req.session.userId!, action: "INVOICE_REVISED", entityType: "invoice", entityId: invoice.id, details: { reason: "Line item added", invoiceNumber: invoice.number } });

      const maxSort = invoice.lines.reduce((max, l) => Math.max(max, l.sortOrder ?? 0), 0);
      const line = await storage.createInvoiceLine({
        orgId,
        invoiceId: invoice.id,
        description: parsed.description,
        quantity: parsed.quantity.toFixed(2),
        unitRate: parsed.unitRate.toFixed(2),
        amount: amount.toFixed(2),
        sortOrder: maxSort + 1,
      });

      await storage.recalcInvoiceTotals(invoice.id, orgId);

      return res.json(line);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  },
);

app.put(
  "/api/invoices/:id/lines/:lineId",
  requireManagerOrAbove,
  async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const invoice = await storage.getInvoice(req.params.id as string, orgId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      if (!EDITABLE_STATUSES.includes(invoice.status)) {
        return res.status(400).json({ message: "Cannot edit this invoice" });
      }

      const existingLine = await storage.getInvoiceLineById(req.params.lineId as string, orgId);
      if (!existingLine || existingLine.invoiceId !== invoice.id) {
        return res.status(404).json({ message: "Line item not found" });
      }

      const parsed = updateInvoiceLineSchema.parse(req.body);

      await saveRevisionIfNeeded(invoice.id, orgId, "Line item edited");
      await storage.createAuditLog({ orgId, userId: req.session.userId!, action: "INVOICE_REVISED", entityType: "invoice", entityId: invoice.id, details: { reason: "Line item edited", invoiceNumber: invoice.number } });
      const amount = round2(parsed.quantity * parsed.unitRate);

      const line = await storage.updateInvoiceLine(req.params.lineId as string, {
        description: parsed.description,
        quantity: parsed.quantity.toFixed(2),
        unitRate: parsed.unitRate.toFixed(2),
        amount: amount.toFixed(2),
      }, orgId);

      await storage.recalcInvoiceTotals(invoice.id, orgId);

      return res.json(line);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  },
);

app.delete(
  "/api/invoices/:id/lines/:lineId",
  requireManagerOrAbove,
  async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const invoice = await storage.getInvoice(req.params.id as string, orgId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      if (!EDITABLE_STATUSES.includes(invoice.status)) {
        return res.status(400).json({ message: "Cannot edit this invoice" });
      }

      const existingLine = await storage.getInvoiceLineById(req.params.lineId as string, orgId);
      if (!existingLine || existingLine.invoiceId !== invoice.id) {
        return res.status(404).json({ message: "Line item not found" });
      }

      await saveRevisionIfNeeded(invoice.id, orgId, "Line item deleted");
      await storage.createAuditLog({ orgId, userId: req.session.userId!, action: "INVOICE_REVISED", entityType: "invoice", entityId: invoice.id, details: { reason: "Line item deleted", invoiceNumber: invoice.number } });
      await storage.deleteInvoiceLine(req.params.lineId as string, orgId);
      await storage.recalcInvoiceTotals(invoice.id, orgId);

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  },
);

app.get("/api/invoices/:id", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const invoice = await storage.getInvoice(req.params.id as string, orgId);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }
    return res.json(invoice);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.delete("/api/invoices/:id", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const invoiceId = req.params.id as string;
    const invoice = await storage.getInvoice(invoiceId, orgId);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }
    const result = await storage.deleteInvoice(invoiceId, orgId);
    if (!result.deleted) {
      const status = result.error === "Invoice not found" ? 404 : 400;
      return res.status(status).json({ message: result.error });
    }
    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "INVOICE_DELETED",
      entityType: "invoice",
      entityId: invoice.id,
      details: { number: invoice.number, clientId: invoice.clientId, total: invoice.total },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ message: sanitizeErrorMessage(err.message) });
  }
});

app.patch(
  "/api/invoices/:id",
  requireManagerOrAbove,
  async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const invoice = await storage.getInvoice(req.params.id as string, orgId);
      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      const parsed = updateInvoiceSchema.parse(req.body);

      // showTimeEntryDetails is display-only and may be patched on locked
      // invoices. Other (financial) fields still hit the editability guard.
      const isDisplayOnlyPatch =
        parsed.showTimeEntryDetails !== undefined &&
        Object.keys(parsed).every((k) => k === "showTimeEntryDetails");

      if (!isDisplayOnlyPatch && !EDITABLE_STATUSES.includes(invoice.status)) {
        return res.status(400).json({ message: "Cannot edit this invoice" });
      }

      if (Number(invoice.total) > 0 && (!invoice.lines || invoice.lines.length === 0)) {
        return res.status(400).json({ message: "Cannot save an invoice with a total greater than zero and no line items" });
      }

      if (parsed.discountType !== undefined && parsed.discountValue !== undefined && parsed.taxRate !== undefined) {
        if (parsed.discountValue < 0) {
          return res.status(400).json({ message: "Discount value cannot be negative" });
        }
        if (parsed.taxRate < 0) {
          return res.status(400).json({ message: "Tax rate cannot be negative" });
        }
        if (parsed.discountType === "PERCENT" && parsed.discountValue > 100) {
          return res.status(400).json({ message: "Discount percentage cannot exceed 100%" });
        }
        await saveRevisionIfNeeded(invoice.id, orgId, "Discount/tax changed");
        await storage.createAuditLog({ orgId, userId: req.session.userId!, action: "INVOICE_REVISED", entityType: "invoice", entityId: invoice.id, details: { reason: "Discount/tax changed", invoiceNumber: invoice.number } });
        await storage.updateInvoiceDiscountTax(
          invoice.id,
          orgId,
          parsed.discountType,
          parsed.discountValue,
          parsed.taxRate,
        );
      }

      if (parsed.notes !== undefined) {
        await storage.updateInvoiceNotes(invoice.id, orgId, parsed.notes);
      }

      if (parsed.currency !== undefined || parsed.exchangeRate !== undefined) {
        const updates: Record<string, any> = {};
        if (parsed.currency !== undefined) updates.currency = parsed.currency;
        if (parsed.exchangeRate !== undefined) updates.exchangeRate = parsed.exchangeRate;
        await db.update(invoices).set(updates).where(eq(invoices.id, invoice.id));
      }

      if (parsed.showTimeEntryDetails !== undefined) {
        await db.update(invoices)
          .set({ showTimeEntryDetails: parsed.showTimeEntryDetails })
          .where(and(eq(invoices.id, invoice.id), eq(invoices.orgId, orgId)));
      }

      const updated = await storage.getInvoice(invoice.id, orgId);
      if (updated && Number(updated.total) < 0) {
        return res.status(400).json({ message: "Invoice total cannot be negative. Adjust discount or line items." });
      }
      return res.json(updated);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  },
);

app.get("/api/invoices/:id/revisions", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const invoice = await storage.getInvoice(req.params.id as string, orgId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    const revisions = await storage.getInvoiceRevisions(invoice.id);
    return res.json(revisions);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/invoices/:id/revisions", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const userId = req.session.userId!;
    const invoice = await storage.getInvoice(req.params.id as string, orgId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    if (invoice.status === "DRAFT" || invoice.status === "VOID" || invoice.status === "PAID") {
      return res.status(400).json({ message: `Cannot revise an invoice with status ${invoice.status}. Only SENT or PARTIAL invoices can be revised.` });
    }

    const { reason, updates } = req.body || {};
    if (!updates || typeof updates !== "object") {
      return res.status(400).json({ message: "updates object is required" });
    }

    const snapshot = buildInvoiceSnapshot(invoice);
    const revision = await storage.createInvoiceRevision(invoice.id, snapshot, reason || "Manual revision", orgId, userId);

    if (updates.notes !== undefined) {
      await storage.updateInvoiceNotes(invoice.id, orgId, updates.notes);
    }

    if (updates.dueDate !== undefined) {
      await db.update(invoices)
        .set({ dueDate: updates.dueDate })
        .where(and(eq(invoices.id, invoice.id), eq(invoices.orgId, orgId)));
    }

    if (updates.lines && Array.isArray(updates.lines)) {
      for (const lineUpdate of updates.lines) {
        if (lineUpdate.id) {
          await storage.updateInvoiceLine(lineUpdate.id, {
            description: lineUpdate.description,
            quantity: String(lineUpdate.quantity),
            unitRate: String(lineUpdate.unitRate),
            amount: String(round2(Number(lineUpdate.quantity) * Number(lineUpdate.unitRate))),
          }, orgId);
        }
      }
    }

    const discountType = updates.discount?.type ?? invoice.discountType ?? "NONE";
    const discountValue = updates.discount?.value !== undefined ? Number(updates.discount.value) : Number(invoice.discountValue ?? 0);
    const taxRate = updates.tax !== undefined ? Number(updates.tax) : Number(invoice.taxRate ?? 0);

    if (updates.discount !== undefined || updates.tax !== undefined) {
      await storage.updateInvoiceDiscountTax(invoice.id, orgId, discountType, discountValue, taxRate);
    }

    const updatedInvoice = await storage.getInvoice(invoice.id, orgId);
    return res.json({ revision, invoice: updatedInvoice });
  } catch (err: any) {
    return res.status(400).json({ message: sanitizeErrorMessage(err) });
  }
});

app.post("/api/invoices/:id/duplicate", requireManagerOrAbove, async (req, res) => {
  const result = await storage.duplicateInvoice(req.params.id as string, req.session.orgId!);
  if (!result) return res.status(404).json({ message: "Invoice not found" });
  return res.json(result);
});

app.post(
  "/api/invoices/:id/send",
  requireManagerOrAbove,
  async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const invoice = await storage.getInvoice(req.params.id as string, orgId);

      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      if (invoice.status !== "DRAFT") {
        return res
          .status(400)
          .json({ message: "Only draft invoices can be sent" });
      }

      if (!invoice.lines || invoice.lines.length === 0) {
        return res
          .status(400)
          .json({ message: "Cannot send an invoice with no line items. Please add at least one line item before sending." });
      }

      let token = invoice.publicToken;
      if (!token) {
        token = randomBytes(32).toString("hex");
      }

      const [sent] = await db
        .update(invoices)
        .set({ status: "SENT" as any, publicToken: token })
        .where(and(eq(invoices.id, invoice.id), eq(invoices.orgId, orgId), eq(invoices.status, "DRAFT" as any)))
        .returning();

      if (!sent) {
        return res.status(409).json({ message: "Invoice status changed concurrently, please retry" });
      }

      const sentSnapshot = buildInvoiceSnapshot({ ...invoice, status: "SENT", publicToken: token });
      await storage.createInvoiceRevision(
        invoice.id,
        sentSnapshot,
        "Original invoice sent",
        orgId,
      );

      const baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
      const viewLink = `${baseUrl}/i/${token}`;
      const pdfLink = `${baseUrl}/api/public/invoices/${token}/pdf`;

      const { emailTo: customTo, emailSubject: customSubject, emailBody: customBody } = req.body || {};
      const toEmail = customTo || invoice.clientEmail || "";
      const clientData = await storage.getClientById(invoice.clientId, orgId);
      const portalLink = clientData?.portalToken ? `${baseUrl}/portal/${clientData.portalToken}` : null;
      const orgForEmail = await storage.getOrg(orgId);
      const orgName = orgForEmail?.name || "CherryWorks Pro";
      const subject = customSubject || `Invoice ${invoice.number} from ${orgName}`;
      const body = buildInvoiceEmailHtml({
        clientName: invoice.clientName,
        invoiceNumber: invoice.number,
        total: Number(invoice.total).toFixed(2),
        dueDate: invoice.dueDate,
        viewLink,
        pdfLink,
        portalLink,
        orgName,
        isResend: false,
        customMessage: customBody || undefined,
      });

      const outboxEmail = await storage.createOutboxEmail({
        orgId,
        invoiceId: invoice.id,
        toEmail: toEmail || "no-recipient",
        subject,
        body,
        status: "PENDING",
      });

      if (toEmail) {
        try {
          const fullInvoice = await storage.getInvoice(invoice.id, orgId);
          const orgData = await storage.getOrg(orgId);
          const smtpConfig = getSmtpConfigFromOrg(orgData);
          let pdfBuffer: Buffer | undefined;
          if (fullInvoice) {
            const { getInvoiceTimeEntryDetails, resolveShowTimeEntryDetails } = await import("../invoice-details");
            const showDetails = resolveShowTimeEntryDetails(
              fullInvoice.showTimeEntryDetails,
              orgData?.showTimeEntryDetails,
            );
            const lineDetails = showDetails
              ? await getInvoiceTimeEntryDetails(fullInvoice.id, orgId)
              : undefined;
            pdfBuffer = await generateInvoicePdf(fullInvoice, orgData, baseUrl, lineDetails);
          }
          const billingContacts = await storage.getBillingContactsByClient(invoice.clientId, orgId);
          const ccEmails = billingContacts.map(c => c.email).filter(Boolean) as string[];
          await sendInvoiceEmail(toEmail, subject, body, pdfBuffer, smtpConfig, ccEmails.length > 0 ? ccEmails : undefined, orgData);
          await storage.updateOutboxEmailStatus(outboxEmail.id, "SENT");
        } catch (smtpErr: any) {
          await storage.updateOutboxEmailStatus(
            outboxEmail.id,
            "FAILED",
            smtpErr.message,
          );
        }
      }

      fireWebhookEvent(orgId, "invoice.sent", { id: invoice.id, number: invoice.number, clientId: invoice.clientId, status: "SENT" });

      await storage.createAuditLog({
        orgId,
        userId: req.session.userId!,
        action: "INVOICE_SENT",
        entityType: "invoice",
        entityId: invoice.id,
        details: { number: invoice.number, publicToken: token },
      });

      {
        const xr = Number(invoice.exchangeRate) || 1;
        const invTotal = round2((Number(invoice.total) || 0) * xr);
        const invSubtotal = round2((Number(invoice.subtotal) || invTotal) * xr);
        const invTax = round2((Number(invoice.taxAmount) || 0) * xr);
        const today = new Date().toISOString().split("T")[0];
        const currSuffix = invoice.currency && invoice.currency !== "USD" ? ` (${invoice.currency})` : "";
        const glLines: { accountNumber: string; debit: string; credit: string; memo?: string }[] = [
          { accountNumber: "1200", debit: invTotal.toFixed(2), credit: "0.00", memo: "Accounts Receivable" },
          { accountNumber: "4000", debit: "0.00", credit: invSubtotal.toFixed(2), memo: "Service Revenue" },
        ];
        if (invTax > 0) {
          glLines.push({ accountNumber: "2300", debit: "0.00", credit: invTax.toFixed(2), memo: "Sales Tax Payable" });
        }
        if ((Number(invoice.discountAmount) || 0) > 0) {
          // Contra-revenue plug so the entry balances: DR AR(total) + DR Discount
          // == CR Revenue(subtotal) + CR Tax, since total = subtotal + tax -
          // discount. Derived from the already-scaled line amounts so it is exact
          // under any exchange rate (audit #6/7/15/16).
          const invDiscount = round2(invSubtotal + invTax - invTotal);
          if (invDiscount > 0) {
            glLines.push({ accountNumber: "4100", debit: invDiscount.toFixed(2), credit: "0.00", memo: "Sales Discounts" });
          }
        }
        await createAutoJournalEntry(orgId, today, `Invoice ${invoice.number} sent${currSuffix}`, "INVOICE", invoice.id, glLines, req.session.userId);
      }

      // ── Auto-create PENDING payouts for team members on this invoice ──
      // NOTE: Only independent and corp-to-corp workers get auto-payouts.
      // W-2 employees are paid through payroll, not through this system.
      let payoutError = false;
      try {
        // Get all invoice lines for this invoice
        const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id));

        // Get all time entries linked to these lines
        const lineIds = lines.map(l => l.id);
        const linkedEntries = [];
        for (const lineId of lineIds) {
          const entries = await db.select().from(timeEntries).where(
            and(eq(timeEntries.invoiceLineId, lineId), eq(timeEntries.orgId, orgId))
          );
          linkedEntries.push(...entries);
        }

        if (linkedEntries.length > 0) {
          // Group entries by team member
          const byTeamMember: Record<string, typeof linkedEntries> = {};
          for (const entry of linkedEntries) {
            if (!byTeamMember[entry.userId]) byTeamMember[entry.userId] = [];
            byTeamMember[entry.userId].push(entry);
          }

          // Get cost rates for each team member per project
          for (const [teamMemberId, entries] of Object.entries(byTeamMember)) {
            // Skip W-2 employees — they are paid through payroll
            const teamMemberUser = await storage.getUserById(teamMemberId);
            if (teamMemberUser?.workerType === "W2_EMPLOYEE") continue;

            // Check if a PENDING payout already exists for this team member+invoice
            const existingPayouts = await storage.getTeamMemberPayouts(orgId, { teamMemberId, status: "PENDING" });
            const alreadyHasPending = existingPayouts.some(p =>
              p.notes && p.notes.includes(`Invoice ${invoice.number}`)
            );
            if (alreadyHasPending) continue;

            const memberships = await db.select().from(projectMembers).where(eq(projectMembers.userId, teamMemberId));
            const costRateByProject: Record<string, number> = {};
            for (const m of memberships) {
              costRateByProject[m.projectId] = Number(m.costRateHourly) || 0;
            }

            let totalOwed = 0;
            const entryAmounts: { timeEntryId: string; amount: string }[] = [];
            let minDate = entries[0].date;
            let maxDate = entries[0].date;

            for (const e of entries) {
              const rate = e.costRateSnapshot != null ? Number(e.costRateSnapshot) : (costRateByProject[e.projectId] || 0);
              const amt = round2((e.minutes / 60) * rate);
              totalOwed += amt;
              entryAmounts.push({ timeEntryId: e.id, amount: String(amt) });
              if (e.date < minDate) minDate = e.date;
              if (e.date > maxDate) maxDate = e.date;
            }

            if (totalOwed > 0) {
              // Get team member info for payment method
              const teamMember = await storage.getUserById(teamMemberId);
              const payout = await storage.createTeamMemberPayout({
                orgId,
                teamMemberId,
                amount: String(round2(totalOwed)),
                payoutDate: invoice.dueDate || new Date().toISOString().split("T")[0],
                paymentMethod: teamMember?.paymentMethod || "TBD",
                referenceNumber: null,
                periodStart: minDate,
                periodEnd: maxDate,
                notes: `Auto-created from Invoice ${invoice.number} (${invoice.clientName || "client"})`,
                status: "PENDING",
              });

              await storage.linkTimeEntriesToPayout(payout.id, entryAmounts, orgId);

              await storage.createAuditLog({
                orgId,
                userId: req.session.userId!,
                action: "PAYOUT_AUTO_CREATED",
                entityType: "payout",
                entityId: payout.id,
                details: {
                  teamMemberName: teamMember?.name || "Unknown",
                  amount: round2(totalOwed),
                  invoiceNumber: invoice.number,
                  entryCount: entries.length,
                },
              });
            }
          }
        }
      } catch (autoPayoutErr: any) {
        payoutError = true;
        console.error("[auto-payout] Error creating pending payouts:", autoPayoutErr.message);
        try {
          await storage.createAuditLog({
            orgId,
            userId: req.session.userId!,
            action: "INVOICE_SENT_PAYOUT_ERROR",
            entityType: "invoice",
            entityId: invoice.id,
            details: { error: autoPayoutErr.message },
          });
        } catch (_) {}
      }

      return res.json({ ok: true, publicToken: token, viewLink, ...(payoutError ? { payoutWarning: "Invoice sent but automatic team member payouts failed. Check audit log." } : {}) });
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  },
);

app.post(
  "/api/invoices/:id/resend",
  requireManagerOrAbove,
  async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const invoice = await storage.getInvoice(req.params.id as string, orgId);

      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      if (!["SENT", "PARTIAL", "PAID"].includes(invoice.status)) {
        return res
          .status(400)
          .json({ message: "Can only resend invoices in SENT, PARTIAL, or PAID status" });
      }

      const baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
      const viewLink = `${baseUrl}/i/${invoice.publicToken}`;
      const pdfLink = `${baseUrl}/api/public/invoices/${invoice.publicToken}/pdf`;

      const toEmail = invoice.clientEmail || "";
      const subject = `Invoice ${invoice.number} from CherryWorks Pro (Resent)`;
      const clientData = await storage.getClientById(invoice.clientId, orgId);
      const portalLink = clientData?.portalToken ? `${baseUrl}/portal/${clientData.portalToken}` : null;
      const orgForEmail = await storage.getOrg(orgId);
      const orgName = orgForEmail?.name || "CherryWorks Pro";
      const body = buildInvoiceEmailHtml({
        clientName: invoice.clientName,
        invoiceNumber: invoice.number,
        total: Number(invoice.total).toFixed(2),
        dueDate: invoice.dueDate,
        viewLink,
        pdfLink,
        portalLink,
        orgName,
        isResend: true,
      });

      const outboxEmail = await storage.createOutboxEmail({
        orgId,
        invoiceId: invoice.id,
        toEmail: toEmail || "no-recipient",
        subject,
        body,
        status: "PENDING",
      });

      let emailSent = false;
      let emailError: string | null = null;

      if (toEmail) {
        try {
          const fullInvoice = await storage.getInvoice(invoice.id, orgId);
          const orgData = await storage.getOrg(orgId);
          const smtpConfig = getSmtpConfigFromOrg(orgData);
          const invoiceForPdf = fullInvoice || invoice;
          const { getInvoiceTimeEntryDetails, resolveShowTimeEntryDetails } = await import("../invoice-details");
          const showDetails = resolveShowTimeEntryDetails(
            invoiceForPdf.showTimeEntryDetails,
            orgData?.showTimeEntryDetails,
          );
          const lineDetails = showDetails
            ? await getInvoiceTimeEntryDetails(invoiceForPdf.id, orgId)
            : undefined;
          const pdfBuffer = await generateInvoicePdf(invoiceForPdf, orgData, baseUrl, lineDetails);
          const billingContacts = await storage.getBillingContactsByClient(invoice.clientId, orgId);
          const ccEmails = billingContacts.map(c => c.email).filter(Boolean) as string[];
          await sendInvoiceEmail(toEmail, subject, body, pdfBuffer, smtpConfig, ccEmails.length > 0 ? ccEmails : undefined, orgData);
          await storage.updateOutboxEmailStatus(outboxEmail.id, "SENT");
          emailSent = true;
        } catch (smtpErr: any) {
          emailError = smtpErr.message;
          await storage.updateOutboxEmailStatus(
            outboxEmail.id,
            "FAILED",
            smtpErr.message,
          );
        }
      }

      await storage.createAuditLog({
        orgId,
        userId: req.session.userId!,
        action: "INVOICE_RESENT",
        entityType: "invoice",
        entityId: invoice.id,
        details: { number: invoice.number, emailSent, emailError },
      });

      return res.json({ ok: true, emailSent, emailError });
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  },
);

app.post(
  "/api/invoices/:id/void",
  requireAdmin,
  async (req, res) => {
    try {
      const orgId = req.session.orgId!;
      const invoice = await storage.getInvoice(req.params.id as string, orgId);

      if (!invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }

      if (invoice.status === "VOID") {
        return res
          .status(400)
          .json({ message: "Invoice is already voided" });
      }

      await storage.createInvoiceRevision(
        invoice.id,
        buildInvoiceSnapshot(invoice),
        "Voided",
        orgId,
      );

      await storage.updateInvoiceStatus(invoice.id, "VOID", orgId);

      let glWarning = false;
      try {
        const glEntries = await storage.getGLJournalEntriesByOrg(orgId, { sourceType: "INVOICE" });
        const invoiceGlEntry = glEntries.find(je => je.sourceRef === invoice.id);
        if (invoiceGlEntry && invoiceGlEntry.lines.length > 0) {
          const reversalLines = invoiceGlEntry.lines.map(line => ({
            accountId: line.accountId,
            debit: line.credit,
            credit: line.debit,
            memo: `Reversal: Invoice #${invoice.number} voided`,
          }));
          const reversalEntry = await storage.createGLJournalEntry(
            orgId,
            new Date().toISOString().split("T")[0],
            `Reversal: Invoice #${invoice.number} voided`,
            "INVOICE_VOID",
            null,
            true,
            req.session.userId!,
            reversalLines,
            `${invoice.id}-void`,
          );
          await db.update(glJournalEntries)
            .set({ isReversing: true, reversedEntryId: invoiceGlEntry.id })
            .where(eq(glJournalEntries.id, reversalEntry.id));
        }
      } catch (glErr: any) {
        glWarning = true;
        console.error("[GL] Invoice void reversal failed:", glErr.message);
        try {
          await storage.createAuditLog({
            orgId,
            userId: req.session.userId!,
            action: "GL_REVERSAL_FAILED",
            entityType: "invoice",
            entityId: invoice.id,
            details: { error: glErr.message },
          });
        } catch (_) {}
      }

      await storage.createAuditLog({
        orgId,
        userId: req.session.userId!,
        action: "INVOICE_VOIDED",
        entityType: "invoice",
        entityId: invoice.id,
        details: { number: invoice.number },
      });

      return res.json({ ok: true, ...(glWarning ? { glWarning: "Invoice voided but GL reversal failed. Check audit log." } : {}) });
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  },
);

app.get("/api/invoices/:id/details", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const invoice = await storage.getInvoice(req.params.id as string, orgId);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const orgData = await storage.getOrg(orgId);
    const { getInvoiceTimeEntryDetails, resolveShowTimeEntryDetails } = await import("../invoice-details");
    const showDetails = resolveShowTimeEntryDetails(
      invoice.showTimeEntryDetails,
      orgData?.showTimeEntryDetails,
    );
    const detailMap = showDetails
      ? await getInvoiceTimeEntryDetails(invoice.id, orgId)
      : new Map();
    const lineDetails = Object.fromEntries(detailMap);
    return res.json({
      showTimeEntryDetails: showDetails,
      override: invoice.showTimeEntryDetails ?? null,
      orgDefault: !!orgData?.showTimeEntryDetails,
      lineDetails,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});

app.get("/api/invoices/:id/pdf", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const invoice = await storage.getInvoice(req.params.id as string, orgId);

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const { generateInvoicePdf } = await import("../pdf");
    const { getInvoiceTimeEntryDetails, resolveShowTimeEntryDetails } = await import("../invoice-details");
    const orgData = await storage.getOrg(orgId);
    const dlBaseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    // Pre-fetch detail rows; the pdfkit draw loop is synchronous.
    const showDetails = resolveShowTimeEntryDetails(
      invoice.showTimeEntryDetails,
      orgData?.showTimeEntryDetails,
    );
    const lineDetails = showDetails
      ? await getInvoiceTimeEntryDetails(invoice.id, orgId)
      : undefined;
    const pdfBuffer = await generateInvoicePdf(invoice, orgData, dlBaseUrl, lineDetails);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${invoice.number}.pdf"`,
    );
    return res.send(pdfBuffer);
  } catch (err: any) {
    console.error("PDF generation error:", err);
    const msg = err?.message || "";
    if (msg.includes("no line items") || msg.includes("No line items")) {
      return res.status(400).json({ message: msg });
    }
    return res.status(500).json({ message: "PDF generation failed" });
  }
});
app.post("/api/reminders/process", requireManagerOrAbove, async (req, res) => {
  try {
    const { processReminders } = await import("../reminders");
    const result = await processReminders(req.session.orgId!);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});


app.get("/api/public/invoices/:token", publicTokenLimiter, async (req, res) => {
  try {
    const token = req.params.token as string;
    if (!token || token.length !== 64) {
      return res.status(404).json({ message: "Not found" });
    }

    const invoice = await storage.getInvoiceByPublicToken(token);
    if (!invoice) {
      return res.status(404).json({ message: "Not found" });
    }

    const tokenHash = createHash("sha256").update(token).digest("hex").slice(0, 8);
    await storage.createAuditLog({
      orgId: invoice.orgId,
      userId: null,
      action: "PUBLIC_INVOICE_VIEWED",
      entityType: "invoice",
      entityId: invoice.id,
      details: { tokenHashPrefix: tokenHash },
    });

    const outstanding = round2(Number(invoice.total) - Number(invoice.paidAmount));
    const stripeEnabled = !!process.env.STRIPE_SECRET_KEY;

    const client = await storage.getClientById(invoice.clientId, invoice.orgId);

    const orgData = await storage.getOrg(invoice.orgId);
    const { getInvoiceTimeEntryDetails, resolveShowTimeEntryDetails } = await import("../invoice-details");
    const showDetails = resolveShowTimeEntryDetails(
      invoice.showTimeEntryDetails,
      orgData?.showTimeEntryDetails,
    );
    const detailMap = showDetails
      ? await getInvoiceTimeEntryDetails(invoice.id, invoice.orgId)
      : null;
    const lineDetails: Record<string, unknown> | undefined = detailMap
      ? Object.fromEntries(detailMap)
      : undefined;

    return res.json({
      number: invoice.number,
      status: invoice.status,
      issuedDate: invoice.issuedDate,
      dueDate: invoice.dueDate,
      clientName: invoice.clientName,
      currency: invoice.currency,
      portalToken: client?.portalToken || null,
      lines: invoice.lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unitRate: l.unitRate,
        amount: l.amount,
        isHeader: l.isHeader,
      })),
      subtotal: invoice.subtotal,
      discountType: invoice.discountType,
      discountValue: invoice.discountValue,
      discountAmount: invoice.discountAmount,
      taxRate: invoice.taxRate,
      taxAmount: invoice.taxAmount,
      total: invoice.total,
      paidAmount: invoice.paidAmount,
      outstanding: outstanding.toFixed(2),
      stripeEnabled,
      showTimeEntryDetails: showDetails,
      lineDetails,
    });
  } catch {
    return res.status(500).json({ message: "Internal error" });
  }
});
app.get("/api/public/invoices/:token/pdf", publicTokenLimiter, async (req, res) => {
  try {
    const token = req.params.token as string;
    if (!token || token.length !== 64) {
      return res.status(404).json({ message: "Not found" });
    }

    const invoice = await storage.getInvoiceByPublicToken(token);
    if (!invoice) {
      return res.status(404).json({ message: "Not found" });
    }

    const { generateInvoicePdf } = await import("../pdf");
    const { getInvoiceTimeEntryDetails, resolveShowTimeEntryDetails } = await import("../invoice-details");
    const orgData = await storage.getOrg(invoice.orgId);
    const pubBaseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    // Public PDF respects the same effective flag as the
    // authenticated PDF and the public web view.
    const showDetails = resolveShowTimeEntryDetails(
      invoice.showTimeEntryDetails,
      orgData?.showTimeEntryDetails,
    );
    const lineDetails = showDetails
      ? await getInvoiceTimeEntryDetails(invoice.id, invoice.orgId)
      : undefined;
    const pdfBuffer = await generateInvoicePdf(invoice, orgData, pubBaseUrl, lineDetails);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${invoice.number}.pdf"`,
    );
    return res.send(pdfBuffer);
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg.includes("no line items") || msg.includes("No line items")) {
      return res.status(400).json({ message: msg });
    }
    return res.status(500).json({ message: "PDF generation failed" });
  }
});
app.post("/api/public/invoices/:token/checkout", publicTokenLimiter, async (req, res) => {
  try {
    const token = req.params.token as string;
    if (!token || token.length !== 64) {
      return res.status(404).json({ message: "Not found" });
    }

    const invoice = await storage.getInvoiceByPublicToken(token);
    if (!invoice) {
      return res.status(404).json({ message: "Not found" });
    }

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return res.status(400).json({ message: "Online payments are not enabled" });
    }

    const outstanding = round2(Number(invoice.total) - Number(invoice.paidAmount));
    if (outstanding <= 0) {
      return res.status(400).json({ message: "Invoice is already fully paid" });
    }

    const { createStripeCheckout } = await import("../stripe");
    const baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
    const result = await createStripeCheckout({
      invoiceNumber: invoice.number,
      amountCents: Math.round(outstanding * 100),
      currency: invoice.currency,
      successUrl: `${baseUrl}/i/${token}?paid=1`,
      cancelUrl: `${baseUrl}/i/${token}`,
      publicToken: token,
      idempotencyKey: `checkout-invoice-${invoice.id}`,
    });

    await storage.createAuditLog({
      orgId: invoice.orgId,
      userId: null,
      action: "CHECKOUT_SESSION_CREATED",
      entityType: "invoice",
      entityId: invoice.id,
      details: { amount: outstanding, sessionId: result.sessionId },
    });

    return res.json({ url: result.url });
  } catch (err: any) {
    console.error("[checkout] Stripe checkout failed:", err.message || err);
    return res.status(500).json({ message: "Checkout failed" });
  }
});
app.get("/api/recurring-templates", requireManagerOrAbove, async (req, res) => {
  const templates = await storage.getRecurringTemplates(req.session.orgId!);
  res.json(templates);
});
app.get("/api/recurring-templates/:id", requireManagerOrAbove, async (req, res) => {
  const tmpl = await storage.getRecurringTemplate(req.params.id as string, req.session.orgId!);
  if (!tmpl) return res.status(404).json({ message: "Template not found" });
  res.json(tmpl);
});
app.post("/api/recurring-templates", requireManagerOrAbove, async (req, res) => {
  const schema = z.object({
    clientId: z.string().min(1),
    frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"]),
    dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
    nextIssueDate: z.string().min(1),
    templateLines: z.array(z.object({
      description: z.string().min(1),
      quantity: z.number().positive().max(999_999_999.99),
      unitRate: z.number().nonnegative().max(999_999_999.99),
    })),
    discountType: z.string().default("NONE"),
    discountValue: z.coerce.number().default(0),
    taxRate: z.coerce.number().default(0),
    notes: z.string().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const tmpl = await storage.createRecurringTemplate({
    ...parsed.data,
    orgId: req.session.orgId!,
    templateLines: parsed.data.templateLines,
    discountValue: String(parsed.data.discountValue),
    taxRate: String(parsed.data.taxRate),
  });

  await storage.createAuditLog({
    orgId: req.session.orgId!,
    userId: req.session.userId!,
    action: "RECURRING_TEMPLATE_CREATED",
    entityType: "recurring_invoice_templates",
    entityId: tmpl.id,
    details: { frequency: parsed.data.frequency },
  });

  res.status(201).json(tmpl);
});
app.patch("/api/recurring-templates/:id", requireManagerOrAbove, async (req, res) => {
  const schema = z.object({
    frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"]).optional(),
    dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
    nextIssueDate: z.string().optional(),
    templateLines: z.array(z.object({
      description: z.string().min(1),
      quantity: z.number().positive().max(999_999_999.99),
      unitRate: z.number().nonnegative().max(999_999_999.99),
    })).optional(),
    discountType: z.string().optional(),
    discountValue: z.coerce.number().optional(),
    taxRate: z.coerce.number().optional(),
    isActive: z.boolean().optional(),
    notes: z.string().nullable().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

  const update: any = { ...parsed.data };
  if (update.discountValue !== undefined) update.discountValue = String(update.discountValue);
  if (update.taxRate !== undefined) update.taxRate = String(update.taxRate);

  const tmpl = await storage.updateRecurringTemplate(req.params.id as string, req.session.orgId!, update);
  if (!tmpl) return res.status(404).json({ message: "Template not found" });

  await storage.createAuditLog({
    orgId: req.session.orgId!,
    userId: req.session.userId!,
    action: "RECURRING_TEMPLATE_UPDATED",
    entityType: "recurring_invoice_templates",
    entityId: tmpl.id,
    details: {},
  });

  res.json(tmpl);
});
app.delete("/api/recurring-templates/:id", requireManagerOrAbove, async (req, res) => {
  const tmpl = await storage.deactivateRecurringTemplate(req.params.id as string, req.session.orgId!);
  if (!tmpl) return res.status(404).json({ message: "Template not found" });

  await storage.createAuditLog({
    orgId: req.session.orgId!,
    userId: req.session.userId!,
    action: "RECURRING_TEMPLATE_DEACTIVATED",
    entityType: "recurring_invoice_templates",
    entityId: tmpl.id,
    details: {},
  });

  res.json({ ok: true });
});
app.post("/api/recurring-templates/:id/generate", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;

    const lockResult = await pool.query(
      "SELECT pg_try_advisory_lock(200001, hashtext($1)) AS acquired",
      [req.params.id]
    );
    if (!lockResult.rows[0]?.acquired) {
      return res.status(409).json({ message: "Invoice generation already in progress for this template" });
    }

    try {
      const tmpl = await storage.getRecurringTemplate(req.params.id as string, orgId);
      if (!tmpl) return res.status(404).json({ message: "Template not found" });
      if (!tmpl.isActive) return res.status(400).json({ message: "Template is inactive" });

      const org = await storage.getOrg(orgId);
      const invoiceNumber = await storage.getNextInvoiceNumber(orgId);
      const today = new Date().toISOString().split("T")[0];
      const defaultTerms = org?.defaultPaymentTermsDays || 30;
      const dueDate = new Date(Date.now() + defaultTerms * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const invoice = await storage.createInvoice({
        orgId,
        clientId: tmpl.clientId,
        number: invoiceNumber,
        status: "DRAFT",
        issuedDate: today,
        dueDate,
        notes: tmpl.notes,
        discountType: tmpl.discountType || "NONE",
        discountValue: tmpl.discountValue || "0",
        taxRate: tmpl.taxRate || "0",
      });

      const lines = (tmpl.templateLines as any[]) || [];
      for (const line of lines) {
        const amount = round2(Number(line.quantity) * Number(line.unitRate));
        await storage.createInvoiceLine({
          orgId,
          invoiceId: invoice.id,
          description: line.description,
          quantity: String(line.quantity),
          unitRate: String(line.unitRate),
          amount: String(amount),
        });
      }

      await storage.updateInvoiceTotal(invoice.id, req.session.orgId!);

      const nextDate = storage.advanceNextIssueDate(
        tmpl.nextIssueDate,
        tmpl.frequency,
      );
      await storage.updateRecurringTemplate(tmpl.id, orgId, { nextIssueDate: nextDate });

      await storage.createAuditLog({
        orgId,
        userId: req.session.userId!,
        action: "RECURRING_INVOICE_GENERATED",
        entityType: "invoice",
        entityId: invoice.id,
        details: { templateId: tmpl.id, invoiceNumber, nextIssueDate: nextDate },
      });

      fireWebhookEvent(orgId, "invoice.created", { id: invoice.id, number: invoiceNumber, clientId: tmpl.clientId, status: "DRAFT", source: "recurring_template" });

      const result = await storage.getInvoice(invoice.id, orgId);
      res.status(201).json(result);
    } finally {
      await pool.query("SELECT pg_advisory_unlock(200001, hashtext($1))", [req.params.id]).catch(() => {});
    }
  } catch (err: any) {
    res.status(400).json({ message: err.message });
  }
});
app.post("/api/invoices/:id/repost-gl", requireManagerOrAbove, async (req, res) => {
  try {
    const orgId = req.session.orgId!;
    const invoice = await storage.getInvoice(req.params.id as string, orgId);
    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }
    if (!["SENT", "PARTIAL", "PAID"].includes(invoice.status)) {
      return res.status(400).json({ message: "Only sent, partial, or paid invoices can be posted to GL" });
    }

    await storage.seedDefaultGLAccounts(orgId);

    if (await isGlPosted(orgId, "INVOICE", invoice.id)) {
      return res.status(400).json({ message: `Invoice ${invoice.number} already has a GL journal entry` });
    }

    const xr = Number(invoice.exchangeRate) || 1;
    const invTotal = round2((Number(invoice.total) || 0) * xr);
    const invSubtotal = round2((Number(invoice.subtotal) || invTotal) * xr);
    const invTax = round2((Number(invoice.taxAmount) || 0) * xr);
    const entryDate = invoice.issuedDate || new Date().toISOString().split("T")[0];
    const currSuffix = invoice.currency && invoice.currency !== "USD" ? ` (${invoice.currency})` : "";
    const glLines: { accountNumber: string; debit: string; credit: string; memo?: string }[] = [
      { accountNumber: "1200", debit: invTotal.toFixed(2), credit: "0.00", memo: "Accounts Receivable" },
      { accountNumber: "4000", debit: "0.00", credit: invSubtotal.toFixed(2), memo: "Service Revenue" },
    ];
    if (invTax > 0) {
      glLines.push({ accountNumber: "2300", debit: "0.00", credit: invTax.toFixed(2), memo: "Sales Tax Payable" });
    }
    let invDiscount = 0;
    if ((Number(invoice.discountAmount) || 0) > 0) {
      // Contra-revenue plug so the entry balances (audit #6/7/15/16).
      invDiscount = round2(invSubtotal + invTax - invTotal);
      if (invDiscount > 0) {
        glLines.push({ accountNumber: "4100", debit: invDiscount.toFixed(2), credit: "0.00", memo: "Sales Discounts" });
      }
    }
    await createAutoJournalEntry(orgId, entryDate, `Invoice ${invoice.number} sent${currSuffix}`, "INVOICE", invoice.id, glLines, req.session.userId);

    // createAutoJournalEntry swallows balance/posting failures into an audit log,
    // so confirm the entry actually landed rather than reporting a false success
    // (audit #16 — previously this returned ok:true even when nothing posted).
    if (!(await isGlPosted(orgId, "INVOICE", invoice.id))) {
      return res.status(500).json({ message: `Failed to post invoice ${invoice.number} to GL — the journal entry was rejected (see GL_AUTO_JOURNAL_FAILED in the audit log).` });
    }

    return res.json({ ok: true, message: `Invoice ${invoice.number} posted to GL (DR AR $${invTotal.toFixed(2)}, CR Revenue $${invSubtotal.toFixed(2)}${invTax > 0 ? `, CR Tax $${invTax.toFixed(2)}` : ""}${invDiscount > 0 ? `, DR Sales Discounts $${invDiscount.toFixed(2)}` : ""})` });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
}
