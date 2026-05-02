import { db, pool } from "./db";
import { invoices, invoiceLines, clients, clientContacts, orgs } from "@shared/schema";
import { eq, and, lt, inArray, sql, asc } from "drizzle-orm";
import { sendInvoiceEmail } from "./email";
import { generateInvoicePdf } from "./pdf";
import type { OrgBranding } from "./pdf";

const KNOWN_TEMPLATE_VARS = new Set([
  "clientName", "number", "total", "dueDate", "orgName", "viewLink",
  "invoiceNumber", "invoiceTotal", "invoiceDueDate", "invoiceLink",
  "companyName", "daysOverdue", "amountDue", "balanceDue", "invoiceDate",
  "publicLink",
]);

function interpolateTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!KNOWN_TEMPLATE_VARS.has(key)) {
      console.warn(`[reminders] Unknown template variable: {{${key}}} — left as-is`);
      return match;
    }
    const safe = String(vars[key] ?? match).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    return safe;
  });
}

export async function processReminders(orgId: string) {
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  if (!org || !org.reminderEnabled) {
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const reminderDaysOverdue: number[] = Array.isArray(org.reminderDaysOverdue)
    ? (org.reminderDaysOverdue as number[])
    : JSON.parse(String(org.reminderDaysOverdue || "[]"));

  if (reminderDaysOverdue.length === 0) {
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const overdueInvoices = await db
    .select({
      invoice: invoices,
      clientName: clients.name,
      clientEmail: clients.email,
    })
    .from(invoices)
    .innerJoin(clients, eq(invoices.clientId, clients.id))
    .where(
      and(
        eq(invoices.orgId, orgId),
        inArray(invoices.status, ["SENT", "PARTIAL"]),
        lt(invoices.dueDate, todayStr),
      ),
    );

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  const subjectTemplate = org.reminderSubjectTemplate || "Reminder: Invoice {{number}} is overdue";
  const bodyTemplate = org.reminderBodyTemplate || "Dear {{clientName}},\n\nInvoice {{number}} for {{total}} was due on {{dueDate}}.\n\nThank you,\n{{orgName}}";

  const orgBranding: OrgBranding = {
    name: org.name,
    address: org.address,
    phone: org.phone,
    email: org.email,
    website: org.website,
    logoUrl: org.logoUrl,
  };

  for (const row of overdueInvoices) {
    const inv = row.invoice;
    const dueDate = new Date(inv.dueDate);
    const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    if (!reminderDaysOverdue.includes(daysOverdue)) {
      skipped++;
      continue;
    }

    if (inv.lastReminderSentAt && new Date(inv.lastReminderSentAt) > twentyFourHoursAgo) {
      skipped++;
      continue;
    }

    const toEmail = row.clientEmail;
    if (!toEmail) {
      skipped++;
      continue;
    }

    const viewLink = inv.publicToken ? `/i/${inv.publicToken}` : "";

    const vars: Record<string, string> = {
      clientName: row.clientName,
      orgName: org.name,
      companyName: org.name,
      number: inv.number,
      invoiceNumber: inv.number,
      total: inv.total,
      invoiceTotal: inv.total,
      dueDate: inv.dueDate,
      invoiceDueDate: inv.dueDate,
      invoiceDate: inv.issuedDate,
      viewLink,
      invoiceLink: viewLink,
      publicLink: viewLink,
      daysOverdue: String(daysOverdue),
      amountDue: inv.total,
      balanceDue: inv.total,
    };

    const subject = interpolateTemplate(subjectTemplate, vars);
    const body = interpolateTemplate(bodyTemplate, vars);

    try {
      const reminderLines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id)).orderBy(asc(invoiceLines.sortOrder));
      const pdfBuffer = await generateInvoicePdf(
        { ...inv, clientName: row.clientName, clientEmail: toEmail, lines: reminderLines },
        orgBranding,
      );
      const billingContacts = await db.select().from(clientContacts).where(
        and(eq(clientContacts.clientId, inv.clientId), eq(clientContacts.orgId, orgId), sql`lower(${clientContacts.role}) = 'billing'`)
      );
      const ccEmails = billingContacts.map(c => c.email).filter(Boolean) as string[];
      await db
        .update(invoices)
        .set({ lastReminderSentAt: new Date() })
        .where(eq(invoices.id, inv.id));
      try {
        await sendInvoiceEmail(toEmail, subject, body, pdfBuffer, undefined, ccEmails.length > 0 ? ccEmails : undefined, org);
      } catch (emailErr) {
        await db
          .update(invoices)
          .set({ lastReminderSentAt: null })
          .where(eq(invoices.id, inv.id));
        throw emailErr;
      }
      sent++;
    } catch {
      errors++;
    }
  }

  return { sent, skipped, errors };
}

let reminderInterval: ReturnType<typeof setInterval> | null = null;

async function processAllReminders(): Promise<void> {
  const lockResult = await pool.query("SELECT pg_try_advisory_lock(100002) AS acquired");
  if (!lockResult.rows[0]?.acquired) return;
  try {
    const allOrgs = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.reminderEnabled, true));
    for (const org of allOrgs) {
      try {
        const result = await processReminders(org.id);
        if (result.sent > 0) {
          console.log(`[reminders] org=${org.id}: sent=${result.sent} skipped=${result.skipped} errors=${result.errors}`);
        }
      } catch (err: any) {
        console.error(`[reminders] Error processing org ${org.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[reminders] Error in processAllReminders:", err);
  } finally {
    await pool.query("SELECT pg_advisory_unlock(100002)").catch(() => {});
  }
}

async function processRecurringInvoices(): Promise<void> {
  const lockResult = await pool.query("SELECT pg_try_advisory_lock(100003) AS acquired");
  if (!lockResult.rows[0]?.acquired) return;
  try {
    const allOrgs = await db.select({ id: orgs.id }).from(orgs);
    const today = new Date().toISOString().split("T")[0];
    for (const org of allOrgs) {
      try {
        const { storage } = await import("./storage");
        const templates = await storage.getActiveTemplatesDue(org.id, today);
        for (const tmpl of templates) {
          const idempotencyKey = `${tmpl.id}_${tmpl.nextIssueDate}`;
          const lockAcquired = await pool.query(
            "SELECT pg_try_advisory_lock(200002, hashtext($1)) AS acquired",
            [idempotencyKey]
          );
          if (!lockAcquired.rows[0]?.acquired) continue;
          try {
            const fresh = await storage.getRecurringTemplate(tmpl.id, org.id);
            if (!fresh || !fresh.isActive || fresh.nextIssueDate > today) continue;

            const orgData = await storage.getOrg(org.id);
            const invoiceNumber = await storage.getNextInvoiceNumber(org.id);
            const defaultTerms = orgData?.defaultPaymentTermsDays || 30;
            const dueDate = new Date(Date.now() + defaultTerms * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

            const invoice = await storage.createInvoice({
              orgId: org.id,
              clientId: fresh.clientId,
              number: invoiceNumber,
              status: "DRAFT",
              issuedDate: today,
              dueDate,
              notes: fresh.notes,
              discountType: fresh.discountType || "NONE",
              discountValue: fresh.discountValue || "0",
              taxRate: fresh.taxRate || "0",
            });

            const lines = (fresh.templateLines as any[]) || [];
            for (const line of lines) {
              const amount = Number((Number(line.quantity) * Number(line.unitRate)).toFixed(2));
              await storage.createInvoiceLine({
                orgId: org.id,
                invoiceId: invoice.id,
                description: line.description,
                quantity: String(line.quantity),
                unitRate: String(line.unitRate),
                amount: String(amount),
              });
            }
            await storage.updateInvoiceTotal(invoice.id, org.id);

            const nextDate = storage.advanceNextIssueDate(fresh.nextIssueDate, fresh.frequency);
            await storage.updateRecurringTemplate(fresh.id, org.id, { nextIssueDate: nextDate });

            await storage.createAuditLog({
              orgId: org.id,
              action: "RECURRING_INVOICE_AUTO_GENERATED",
              entityType: "invoice",
              entityId: invoice.id,
              details: { templateId: fresh.id, invoiceNumber, nextIssueDate: nextDate },
            });
            console.log(`[recurring] org=${org.id} template=${fresh.id} => invoice ${invoiceNumber}`);
          } finally {
            await pool.query("SELECT pg_advisory_unlock(200002, hashtext($1))", [idempotencyKey]).catch(() => {});
          }
        }
      } catch (err: any) {
        console.error(`[recurring] Error processing org ${org.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[recurring] Error in processRecurringInvoices:", err);
  } finally {
    await pool.query("SELECT pg_advisory_unlock(100003)").catch(() => {});
  }
}

async function processDataRetention(): Promise<void> {
  const lockResult = await pool.query("SELECT pg_try_advisory_lock(100004) AS acquired");
  if (!lockResult.rows[0]?.acquired) return;
  try {
    const allOrgs = await db.select().from(orgs);
    for (const org of allOrgs) {
      try {
        const retentionDays = (org as any).dataRetentionDays || 0;
        if (retentionDays <= 0) continue;
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

        const result = await pool.query(
          `DELETE FROM time_entries WHERE org_id = $1 AND invoice_line_id IS NULL AND date < $2`,
          [org.id, cutoff]
        );
        const deleted = result.rowCount || 0;
        if (deleted > 0) {
          const { storage } = await import("./storage");
          await storage.createAuditLog({
            orgId: org.id,
            action: "DATA_RETENTION_SWEEP",
            entityType: "time_entries",
            details: { deletedCount: deleted, cutoffDate: cutoff, retentionDays },
          });
          console.log(`[retention] org=${org.id}: deleted ${deleted} old unbilled time entries before ${cutoff}`);
        }
      } catch (err: any) {
        console.error(`[retention] Error processing org ${org.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[retention] Error in processDataRetention:", err);
  } finally {
    await pool.query("SELECT pg_advisory_unlock(100004)").catch(() => {});
  }
}

export function startReminderProcessor(): void {
  if (reminderInterval) return;
  reminderInterval = setInterval(async () => {
    await processAllReminders();
    await processRecurringInvoices();
    await processDataRetention();
  }, 60 * 60 * 1000);
  console.log("[reminders] Reminder/recurring/retention processor started (60min interval)");
}

export function stopReminderProcessor(): void {
  if (reminderInterval) {
    clearInterval(reminderInterval);
    reminderInterval = null;
  }
}
