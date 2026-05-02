import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { db } from "../db";
import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { projectMembers, timeEntries, teamMemberPayoutsV2, payoutTimeEntries, round2, createPayoutSchema } from "@shared/schema";
import { sanitizeErrorMessage, requireAuth, requireAdmin, createAutoJournalEntry, reverseGLBySourceRef } from "./middleware";
import { seedDatabase } from "../seed";

export function registerPayoutRoutes(app: Express) {

if (process.env.NODE_ENV === "development") {
  app.post("/api/test/reset-db", async (req, res) => {
    const testSecret = process.env.TEST_SECRET;
    if (!testSecret) {
      return res.status(503).json({ message: "Test secret not configured" });
    }
    const secret = req.headers["x-test-secret"];
    if (secret !== testSecret) {
      return res.status(403).json({ message: "Forbidden" });
    }
    await storage.resetTestData();
    await seedDatabase();
    res.json({ ok: true });
  });
}

// ─── TEAM MEMBER PAYOUTS V2 ──────────────────────────────────
app.get("/api/payouts", requireAdmin, async (req, res) => {
  try {
    const { teamMemberId, status, dateFrom, dateTo } = req.query as Record<string, string>;
    const payouts = await storage.getTeamMemberPayouts(req.session.orgId!, { teamMemberId, status, dateFrom, dateTo });
    return res.json(payouts);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/payouts/summary", requireAdmin, async (req, res) => {
  try {
    const summary = await storage.getPayoutSummaryByTeamMember(req.session.orgId!);
    return res.json(summary);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/payouts/:id", requireAdmin, async (req, res) => {
  try {
    const payout = await storage.getTeamMemberPayoutById(req.params.id as string, req.session.orgId!);
    if (!payout) return res.status(404).json({ message: "Payout not found" });
    const linkedEntries = await storage.getPayoutTimeEntries(payout.id, req.session.orgId!);
    return res.json({ ...payout, linkedEntries });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/payouts", requireAdmin, async (req, res) => {
  try {
    const parsed = createPayoutSchema.parse(req.body);
    const teamMember = await storage.getUserById(parsed.teamMemberId);
    if (!teamMember || teamMember.orgId !== req.session.orgId!) {
      return res.status(400).json({ message: "Team member not found in your organization" });
    }
    if (parsed.timeEntryIds && parsed.timeEntryIds.length > 500) {
      return res.status(400).json({ message: "Bulk operation limited to 500 items" });
    }

    const payout = await db.transaction(async (tx) => {
      const lockKey = Buffer.from(req.session.orgId! + parsed.teamMemberId + parsed.payoutDate).reduce((a, b) => ((a * 31 + b) & 0x7fffffff), 0);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
      const created = await storage.createTeamMemberPayout({
        orgId: req.session.orgId!,
        teamMemberId: parsed.teamMemberId,
        amount: String(parsed.amount),
        payoutDate: parsed.payoutDate,
        paymentMethod: parsed.paymentMethod,
        referenceNumber: parsed.referenceNumber || null,
        periodStart: parsed.periodStart || null,
        periodEnd: parsed.periodEnd || null,
        notes: parsed.notes || null,
        status: parsed.status || "COMPLETED",
      });
      if (parsed.timeEntryIds && parsed.timeEntryIds.length > 0) {
        const memberships = await db.select().from(projectMembers).where(eq(projectMembers.userId, parsed.teamMemberId));
        const costRateByProject: Record<string, number> = {};
        for (const m of memberships) {
          costRateByProject[m.projectId] = Number(m.costRateHourly) || 0;
        }
        const allTe = await db.select().from(timeEntries).where(
          and(
            inArray(timeEntries.id, parsed.timeEntryIds),
            eq(timeEntries.orgId, req.session.orgId!),
            eq(timeEntries.userId, parsed.teamMemberId),
          )
        );
        const entries = allTe.map(te => {
          const rate = te.costRateSnapshot != null ? Number(te.costRateSnapshot) : (costRateByProject[te.projectId] || 0);
          const amt = round2((te.minutes / 60) * rate);
          return { timeEntryId: te.id, amount: String(amt) };
        });
        await storage.linkTimeEntriesToPayout(created.id, entries, req.session.orgId!);
      }
      return created;
    });
    await storage.createAuditLog({
      orgId: req.session.orgId!,
      userId: req.session.userId!,
      action: "PAYOUT_RECORDED",
      entityType: "payout",
      entityId: payout.id,
      details: { teamMemberName: teamMember.name, amount: parsed.amount, method: parsed.paymentMethod },
    });

    const payoutOrg = await storage.getOrg(req.session.orgId!);
    if (payoutOrg?.autoPostJournalEntries) {
      const payoutAmt = Number(parsed.amount).toFixed(2);
      await createAutoJournalEntry(req.session.orgId!, parsed.payoutDate, `Payout to ${teamMember.name}`, "PAYOUT", payout.id, [
        { accountNumber: "5100", debit: payoutAmt, credit: "0.00", memo: "Team payout costs" },
        { accountNumber: "1000", debit: "0.00", credit: payoutAmt, memo: "Cash disbursed" },
      ], req.session.userId);
    }

    return res.json(payout);
  } catch (err: any) {
    if (err.code === "23505" && err.constraint?.includes("uq_payout_dedup")) {
      return res.status(409).json({ message: "A payout with the same team member, amount, date, and method already exists" });
    }
    return res.status(400).json({ message: err.message });
  }
});
app.patch("/api/payouts/:id", requireAdmin, async (req, res) => {
  try {
    const { status, notes, referenceNumber, paymentMethod } = req.body;
    const updates: Record<string, any> = {};
    if (status !== undefined) {
      const validStatuses = ["PENDING", "COMPLETED", "VOID"];
      if (!validStatuses.includes(status)) return res.status(400).json({ message: "Invalid payout status" });
      updates.status = status;
    }
    if (notes !== undefined) updates.notes = notes;
    if (referenceNumber !== undefined) updates.referenceNumber = referenceNumber;
    if (paymentMethod !== undefined) {
      const validMethods = ["ACH", "WIRE", "CHECK", "ZELLE", "OTHER"];
      if (!validMethods.includes(paymentMethod)) return res.status(400).json({ message: "Invalid payment method" });
      updates.paymentMethod = paymentMethod;
    }
    const previousPayout = status ? await storage.getTeamMemberPayoutById(req.params.id as string, req.session.orgId!) : null;
    const updated = await storage.updateTeamMemberPayout(req.params.id as string, req.session.orgId!, updates);
    if (!updated) return res.status(404).json({ message: "Payout not found" });
    if (status === "COMPLETED") {
      await storage.createAuditLog({
        orgId: req.session.orgId!,
        userId: req.session.userId!,
        action: "PAYOUT_MARKED_PAID",
        entityType: "payout",
        entityId: updated.id,
        details: { amount: updated.amount, teamMemberId: updated.teamMemberId, before: { status: previousPayout?.status || "PENDING" } },
      });
    } else if (status === "VOID") {
      await storage.createAuditLog({
        orgId: req.session.orgId!,
        userId: req.session.userId!,
        action: "PAYOUT_CANCELLED",
        entityType: "payout",
        entityId: updated.id,
        details: { amount: updated.amount, teamMemberId: updated.teamMemberId },
      });
    }
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({ message: err.message });
  }
});
app.delete("/api/payouts/:id", requireAdmin, async (req, res) => {
  try {
    const orgId = req.session.orgId!;

    await reverseGLBySourceRef(
      orgId, "PAYOUT", req.params.id as string,
      `Reversal: Payout ${req.params.id} deleted`,
      "PAYOUT_DELETE", req.session.userId!,
    );

    const payout = await storage.getTeamMemberPayoutById(req.params.id as string, orgId);
    const deleted = await storage.deleteTeamMemberPayout(req.params.id as string, orgId);
    if (!deleted) return res.status(404).json({ message: "Payout not found" });
    await storage.createAuditLog({
      orgId,
      userId: req.session.userId!,
      action: "PAYOUT_CANCELLED",
      entityType: "payout",
      entityId: req.params.id as string,
      details: { amount: payout?.amount, teamMemberId: payout?.teamMemberId, reason: "deleted" },
    });
    return res.json({ message: "Payout deleted" });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/payouts/team-member/:teamMemberId/unpaid", requireAdmin, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query as Record<string, string>;
    const entries = await storage.getUnpaidTimeEntriesForTeamMember(req.session.orgId!, req.params.teamMemberId as string, dateFrom, dateTo);
    return res.json(entries);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
const TRANSFER_RETRY_DELAYS = [1000, 2000, 4000];

async function executeStripeTransferWithRetry(
  createTransfer: typeof import("../stripe-connect").createTransferToConnectedAccount,
  accountId: string,
  amountCents: number,
  currency: string,
  description: string,
  idempotencyKey: string,
) {
  const maxAttempts = TRANSFER_RETRY_DELAYS.length + 1;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`[stripe] Transfer retry attempt ${attempt}/${maxAttempts} for ${idempotencyKey}`);
      }
      const result = await createTransfer(accountId, amountCents, currency, description, idempotencyKey);
      if (attempt > 1) {
        console.log(`[stripe] Transfer succeeded on attempt ${attempt} for ${idempotencyKey}`);
      }
      return result;
    } catch (err: any) {
      lastError = err;
      console.error(`[stripe] Transfer attempt ${attempt}/${maxAttempts} failed for ${idempotencyKey}: ${err.message}`);
      if (attempt < maxAttempts) {
        const delay = TRANSFER_RETRY_DELAYS[attempt - 1];
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError!;
}

app.post("/api/payouts/:payoutId/execute", requireAdmin, async (req, res) => {
  try {
    const payout = await storage.getTeamMemberPayoutById(req.params.payoutId as string, req.session.orgId!);
    if (!payout) return res.status(404).json({ message: "Payout not found" });
    if (payout.status !== "PENDING") {
      return res.status(400).json({ message: "Only PENDING payouts can be executed via Stripe Connect" });
    }
    if (payout.stripeTransferId) {
      return res.status(400).json({ message: "This payout has already been sent via Stripe Connect" });
    }

    const teamMember = await storage.getUserById(payout.teamMemberId);
    if (!teamMember || teamMember.orgId !== req.session.orgId!) return res.status(404).json({ message: "Team member not found" });
    if (teamMember.stripeConnectStatus !== "ACTIVE") {
      return res.status(400).json({ message: "Team member must complete Stripe Connect onboarding before receiving payouts" });
    }
    const wt = teamMember.workerType || "INDEPENDENT";
    if (wt === "W2_EMPLOYEE") {
      return res.status(400).json({ message: "Cannot send Stripe Connect payouts to W-2 employees" });
    }

    const { createTransferToConnectedAccount } = await import("../stripe-connect");
    const amountCents = Math.round(Number(payout.amount) * 100);
    if (!amountCents || amountCents <= 0 || isNaN(amountCents)) {
      return res.status(400).json({ message: "Invalid payout amount" });
    }
    const result = await executeStripeTransferWithRetry(
      createTransferToConnectedAccount,
      teamMember.stripeConnectAccountId!,
      amountCents,
      "usd",
      `Payout ${payout.id} to ${teamMember.name}`,
      `payout-${payout.id}`,
    );

    try {
      await storage.updateTeamMemberPayout(payout.id, req.session.orgId!, {
        stripeTransferId: result.transferId,
        stripeTransferStatus: "pending",
        paymentMethod: "STRIPE_CONNECT",
        referenceNumber: result.transferId,
      });

      await storage.createAuditLog({
        orgId: req.session.orgId!,
        userId: req.session.userId!,
        action: "STRIPE_CONNECT_PAYOUT_EXECUTED",
        entityType: "payout",
        entityId: payout.id,
        details: { teamMemberName: teamMember.name, amount: payout.amount, transferId: result.transferId },
      });
    } catch (dbErr: any) {
      console.error("[CRITICAL] Stripe transfer succeeded but DB update failed:", dbErr.message, "transferId:", result.transferId);
      try {
        await storage.createAuditLog({
          orgId: req.session.orgId!,
          userId: req.session.userId!,
          action: "STRIPE_TRANSFER_DB_SYNC_FAILED",
          entityType: "payout",
          entityId: payout.id,
          details: { transferId: result.transferId, amount: payout.amount, teamMemberName: teamMember.name, error: dbErr.message },
        });
      } catch {}
      return res.status(500).json({ message: "Transfer sent but recording failed. Transfer ID: " + result.transferId + ". Contact support." });
    }

    return res.json({ transferId: result.transferId, status: result.status });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/connect/dashboard/:userId", requireAdmin, async (req, res) => {
  try {
    const user = await storage.getUserById(req.params.userId as string);
    if (!user || user.orgId !== req.session.orgId!) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!user.stripeConnectAccountId || user.stripeConnectStatus !== "ACTIVE") {
      return res.status(400).json({ message: "Stripe Connect is not active for this user" });
    }
    const { createConnectLoginLink } = await import("../stripe-connect");
    const link = await createConnectLoginLink(user.stripeConnectAccountId);
    return res.json({ url: link.url });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/my/connect-status", requireAuth, async (req, res) => {
  try {
    const user = await storage.getUserById(req.session.userId!);
    if (!user) return res.status(404).json({ message: "User not found" });
    const wt = user.workerType || "INDEPENDENT";
    if (wt === "W2_EMPLOYEE") {
      return res.json({ eligible: false, status: "NOT_ELIGIBLE", reason: "W-2 employees are paid through payroll" });
    }
    if (!user.stripeConnectAccountId) {
      return res.json({ eligible: true, status: user.stripeConnectStatus || "NOT_STARTED" });
    }
    const { getAccountStatus } = await import("../stripe-connect");
    const acctStatus = await getAccountStatus(user.stripeConnectAccountId);

    let reconciledStatus = user.stripeConnectStatus;
    if (acctStatus.chargesEnabled && acctStatus.payoutsEnabled) {
      reconciledStatus = "ACTIVE";
    } else if (acctStatus.detailsSubmitted && reconciledStatus === "ACTIVE") {
      reconciledStatus = "SUSPENDED";
    } else if (acctStatus.detailsSubmitted) {
      reconciledStatus = "ONBOARDING_COMPLETE";
    }
    if (reconciledStatus !== user.stripeConnectStatus) {
      await storage.updateUser(req.session.userId!, req.session.orgId!, { stripeConnectStatus: reconciledStatus });
    }

    return res.json({
      eligible: true,
      status: reconciledStatus,
      chargesEnabled: acctStatus.chargesEnabled,
      payoutsEnabled: acctStatus.payoutsEnabled,
      detailsSubmitted: acctStatus.detailsSubmitted,
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/my/connect-dashboard", requireAuth, async (req, res) => {
  try {
    const user = await storage.getUserById(req.session.userId!);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.stripeConnectAccountId || user.stripeConnectStatus !== "ACTIVE") {
      return res.status(400).json({ message: "Stripe Connect is not active" });
    }
    const { createConnectLoginLink } = await import("../stripe-connect");
    const link = await createConnectLoginLink(user.stripeConnectAccountId);
    return res.json({ url: link.url });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.post("/api/payouts/execute-bulk", requireAdmin, async (req, res) => {
  try {
    const { payoutIds } = req.body;
    if (!Array.isArray(payoutIds) || payoutIds.length === 0) {
      return res.status(400).json({ message: "No payout IDs provided" });
    }
    const results: Array<{ payoutId: string; success: boolean; error?: string; transferId?: string }> = [];
    const { createTransferToConnectedAccount } = await import("../stripe-connect");

    for (const payoutId of payoutIds) {
      try {
        const payout = await storage.getTeamMemberPayoutById(payoutId, req.session.orgId!);
        if (!payout || payout.status !== "PENDING" || payout.stripeTransferId) {
          results.push({ payoutId, success: false, error: "Not eligible" });
          continue;
        }
        const teamMember = await storage.getUserById(payout.teamMemberId);
        if (!teamMember || teamMember.stripeConnectStatus !== "ACTIVE") {
          results.push({ payoutId, success: false, error: "Team member not connected" });
          continue;
        }
        const wt = teamMember.workerType || "INDEPENDENT";
        if (wt === "W2_EMPLOYEE") {
          results.push({ payoutId, success: false, error: "W-2 employee" });
          continue;
        }
        const amountCents = Math.round(Number(payout.amount) * 100);
        if (!amountCents || amountCents <= 0 || isNaN(amountCents)) {
          results.push({ payoutId, success: false, error: "Invalid amount" });
          continue;
        }
        const result = await executeStripeTransferWithRetry(
          createTransferToConnectedAccount,
          teamMember.stripeConnectAccountId!,
          amountCents,
          "usd",
          `Payout ${payout.id} to ${teamMember.name}`,
          `payout-${payout.id}`,
        );
        await db.transaction(async (tx) => {
          await tx.update(teamMemberPayoutsV2)
            .set({
              stripeTransferId: result.transferId,
              stripeTransferStatus: "pending",
              paymentMethod: "STRIPE_CONNECT",
              referenceNumber: result.transferId,
            })
            .where(and(eq(teamMemberPayoutsV2.id, payout.id), eq(teamMemberPayoutsV2.orgId, req.session.orgId!)));
          await storage.createAuditLog({
            orgId: req.session.orgId!,
            userId: req.session.userId!,
            action: "STRIPE_CONNECT_PAYOUT_EXECUTED",
            entityType: "payout",
            entityId: payout.id,
            details: { teamMemberName: teamMember.name, amount: payout.amount, transferId: result.transferId },
          }, tx);
        });
        results.push({ payoutId, success: true, transferId: result.transferId });
      } catch (err: any) {
        results.push({ payoutId, success: false, error: err.message });
      }
    }
    return res.json({ results });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/my/earnings", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const orgId = req.session.orgId!;

    const allEntries = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.userId, userId)))
      .orderBy(desc(timeEntries.date));

    const memberships = await db.select().from(projectMembers).where(eq(projectMembers.userId, userId));
    const costRateByProject: Record<string, number> = {};
    for (const m of memberships) {
      costRateByProject[m.projectId] = Number(m.costRateHourly) || 0;
    }

    const paidEntryRows = await db
      .select({ timeEntryId: payoutTimeEntries.timeEntryId })
      .from(payoutTimeEntries)
      .innerJoin(teamMemberPayoutsV2, eq(payoutTimeEntries.payoutId, teamMemberPayoutsV2.id))
      .where(and(
        eq(teamMemberPayoutsV2.orgId, orgId),
        eq(teamMemberPayoutsV2.teamMemberId, userId),
        eq(teamMemberPayoutsV2.status, "COMPLETED"),
      ));
    const paidIds = new Set(paidEntryRows.map(r => r.timeEntryId));

    let totalEarned = 0;
    let pendingPayout = 0;
    let billedToClient = 0;
    let unbilledHours = 0;

    for (const e of allEntries) {
      const rate = e.costRateSnapshot != null ? Number(e.costRateSnapshot) : (costRateByProject[e.projectId] || 0);
      const amount = round2((e.minutes / 60) * rate);
      if (paidIds.has(e.id)) {
        totalEarned += amount;
      } else if (e.invoiced) {
        billedToClient += amount;
        pendingPayout += amount;
      } else {
        unbilledHours += e.minutes;
        pendingPayout += amount;
      }
    }

    const payoutHistory = await storage.getTeamMemberPayouts(orgId, { teamMemberId: userId, status: "COMPLETED" });

    return res.json({
      totalEarned: round2(totalEarned),
      pendingPayout: round2(pendingPayout),
      billedToClient: round2(billedToClient),
      unbilledMinutes: unbilledHours,
      unbilledHours: round2(unbilledHours / 60),
      payoutHistory,
      timeEntries: allEntries.map(e => {
        const rate = e.costRateSnapshot != null ? Number(e.costRateSnapshot) : (costRateByProject[e.projectId] || 0);
        return {
          ...e,
          costRate: rate,
          amount: round2((e.minutes / 60) * rate),
          isPaid: paidIds.has(e.id),
          status: paidIds.has(e.id) ? "PAID" : e.invoiced ? "BILLED" : "UNBILLED",
        };
      }),
    });
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/my/earnings-trend", requireAuth, async (req, res) => {
  try {
    const result = await storage.getTeamMemberEarningsTrend(req.session.orgId!, req.session.userId!);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
app.get("/api/my/hours-trend", requireAuth, async (req, res) => {
  try {
    const result = await storage.getTeamMemberHoursTrend(req.session.orgId!, req.session.userId!);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ message: sanitizeErrorMessage(err) });
  }
});
}
