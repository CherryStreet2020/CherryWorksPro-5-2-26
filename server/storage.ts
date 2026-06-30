import { eq, and, or, sql, desc, asc, ne, gte, lte, lt, inArray, ilike, isNull, isNotNull, type SQL } from "drizzle-orm";
import { db, pool } from "./db";
import { extractDomainFromEmail, isFreeMailDomain, normalizeDomain } from "./lib/domains";
import {
  orgs,
  users,
  clients,
  companies,
  clientContacts,
  clientNotes,
  clientActivities,
  projects,
  projectMembers,
  timeEntries,
  invoices,
  invoiceLines,
  invoiceRevisions,
  payments,
  outboxEmails,
  timesheetWeeks,
  auditLogs,
  stripeEvents,
  importRuns,
  importFiles,
  importedKeys,
  importedPayouts,
  teamMemberPayoutsV2,
  payoutTimeEntries,
  services,
  projectServices,
  recurringInvoiceTemplates,
  estimates,
  estimateLines,
  expenseCategories,
  expenses,
  expenseReports,
  exchangeRates,
  glAccounts,
  glJournalEntries,
  glJournalLines,
  closePeriods,
  pendingInvites,
  computeInvoiceTotals,
  round2,
  round4,
  computeUtilization,
  computeProfitability,
  getAgingBucket,
  getWeekStartDate,
} from "@shared/schema";
import type {
  Org,
  InsertOrg,
  User,
  InsertUser,
  Client,
  InsertClient,
  ClientContact,
  InsertClientContact,
  ClientNote,
  InsertClientNote,
  ClientActivity,
  InsertClientActivity,
  Project,
  InsertProject,
  ProjectMember,
  InsertProjectMember,
  TimeEntry,
  InsertTimeEntry,
  Invoice,
  InsertInvoice,
  InvoiceLine,
  InsertInvoiceLine,
  Payment,
  InsertPayment,
  InsertOutboxEmail,
  InsertTimesheetWeek,
  TimesheetWeek,
  InsertAuditLog,
  StripeEvent,
  InsertStripeEvent,
  ImportRun,
  InsertImportRun,
  ImportFile,
  InsertImportFile,
  ImportedKey,
  InsertImportedKey,
  ImportedPayout,
  InsertImportedPayout,
  TeamMemberPayoutV2,
  InsertTeamMemberPayoutV2,
  PayoutTimeEntry,
  InsertPayoutTimeEntry,
  Service,
  InsertService,
  RecurringInvoiceTemplate,
  InsertRecurringTemplate,
  Estimate,
  InsertEstimate,
  EstimateLine,
  InsertEstimateLine,
  GlAccount,
  InsertGlAccount,
  GlJournalEntry,
  InsertGlJournalEntry,
  GlJournalLine,
  InsertGlJournalLine,
  PendingInvite,
  InsertPendingInvite,
  Brand,
  BrandWithStats,
  InsertBrand,
} from "@shared/schema";

import {
  brands,
  contactTags,
  contactTagAssignments,
  psoContactActivities,
  type PsoContactActivityType,
  contactActivities,
  contactImports,
  contactSegments,
  marketingCampaigns,
  marketingCompanies,
  marketingProspects,
  marketingSequences,
  marketingSequenceSteps,
  marketingSequenceEnrollments,
  emailSendAttempts,
  marketingChatConversations,
  marketingChatMessages,
} from "@shared/schema";
import type {
  ContactTag,
  InsertContactTag,
  ContactActivity,
  InsertContactActivity,
  ContactSegment,
  InsertContactSegment,
  ContactSegmentFilter,
  MarketingCampaign,
  InsertMarketingCampaign,
  MarketingSequence,
  InsertMarketingSequence,
  MarketingSequenceStep,
  InsertMarketingSequenceStep,
  MarketingSequenceEnrollment,
  MarketingSequenceEnrollmentStatus,
  MarketingProspect,
  InsertMarketingProspect,
  MarketingCompany,
  InsertMarketingCompany,
  MarketingProspectLifecycleStage,
  EmailSendAttemptStatus,
  MarketingChatConversation,
  InsertMarketingChatConversation,
  MarketingChatMessage,
  MarketingChatMessageRole,
} from "@shared/schema";

import {
  bankConnections,
  bankTransactions,
  bankTransactionMatches,
  bankReconciliationLogs,
} from "@shared/schema";

import type {
  BankConnection,
  InsertBankConnection,
  BankTransaction,
  InsertBankTransaction,
  BankTransactionMatch,
  InsertBankTransactionMatch,
  BankReconciliationLog,
  InsertBankReconciliationLog,
} from "@shared/schema";

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_REPORT_ROWS = 10000;
const MAX_BULK_SIZE = 500;

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// ──────────────────────────────────────────────────────────────────────
// Brand-stats cache (Task #162)
// listBrandsByOrg joins two grouped aggregates over client_contacts and
// contact_activities. Reads vastly outnumber writes, so a short-lived
// per-org in-memory cache absorbs repeated calls. Writes that can change
// either aggregate (contact insert / soft-delete / brand reassignment;
// email_sent / email_manual activity emit; brand row CRUD) call
// invalidateBrandStatsCache(orgId) to drop the entry. TTL bounds staleness
// in case some uncovered code path mutates rows directly.
// ──────────────────────────────────────────────────────────────────────
const BRAND_STATS_CACHE_TTL_MS = 30_000;
const brandStatsCache = new Map<string, { data: BrandWithStats[]; expiresAt: number }>();

export function invalidateBrandStatsCache(orgId?: string): void {
  if (orgId) brandStatsCache.delete(orgId);
  else brandStatsCache.clear();
}

const ACTIVITY_TYPES_AFFECTING_LAST_SENT = new Set(["email_sent", "email_manual"]);

function paginationToLimitOffset(params?: PaginationParams): { limit: number; offset: number } | null {
  if (!params?.page && !params?.pageSize) return null;
  const page = Math.max(1, params?.page || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params?.pageSize || DEFAULT_PAGE_SIZE));
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

function escapeLikePattern(str: string): string {
  return str.replace(/[\\%_]/g, (ch) => '\\' + ch);
}

const BANKING_ENCRYPTION_KEY: string = (() => {
  const v = process.env.BANKING_ENCRYPTION_KEY;
  if (!v) {
    throw new Error("BANKING_ENCRYPTION_KEY environment variable is required. Set it to a random 64-character hex string.");
  }
  return v;
})();

const LEGACY_BANKING_SALT = "cherryworks-banking-salt";

function deriveBankingKey(secret: string, salt: Buffer | string): Buffer {
  return scryptSync(secret, salt, 32);
}

export function encryptField(plaintext: string): string {
  const salt = randomBytes(16);
  const key = deriveBankingKey(BANKING_ENCRYPTION_KEY, salt);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "enc:v2:" + salt.toString("hex") + ":" + iv.toString("hex") + ":" + tag.toString("hex") + ":" + encrypted.toString("hex");
}

/**
 * Keys to try when decrypting, current key first. During a key rotation, set
 * BANKING_ENCRYPTION_KEY to the new key and BANKING_ENCRYPTION_KEY_OLD to the
 * previous key so existing ciphertext stays readable until it is re-encrypted
 * under the new key (see SECURITY-replit-key-rotation-plan.md). encryptField
 * always uses the current key, so new writes are immediately under the new key.
 * Read dynamically so the fallback can be added/removed via env without a code
 * change. AES-GCM authenticates on decrypt, so the wrong key throws rather than
 * returning garbage — which makes "try current, then old" safe.
 */
function bankingDecryptKeys(): string[] {
  const keys = [BANKING_ENCRYPTION_KEY];
  const old = process.env.BANKING_ENCRYPTION_KEY_OLD;
  if (old && old !== BANKING_ENCRYPTION_KEY) keys.push(old);
  return keys;
}

function decryptFieldWithSecret(ciphertext: string, secret: string): string {
  const afterEnc = ciphertext.slice(4);
  if (afterEnc.startsWith("v2:")) {
    const parts = afterEnc.slice(3).split(":");
    if (parts.length !== 4) throw new Error("Invalid encrypted banking field format (v2)");
    const salt = Buffer.from(parts[0], "hex");
    const iv = Buffer.from(parts[1], "hex");
    const tag = Buffer.from(parts[2], "hex");
    const encrypted = Buffer.from(parts[3], "hex");
    const key = deriveBankingKey(secret, salt);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final("utf8");
  }
  const parts = afterEnc.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted banking field format");
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const encrypted = Buffer.from(parts[2], "hex");
  const key = deriveBankingKey(secret, LEGACY_BANKING_SALT);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function decryptField(ciphertext: string): string {
  if (!ciphertext.startsWith("enc:")) return ciphertext;
  const keys = bankingDecryptKeys();
  let lastErr: unknown;
  for (const secret of keys) {
    try {
      return decryptFieldWithSecret(ciphertext, secret);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Failed to decrypt banking field with any configured key");
}

/**
 * Rotation tooling: true if a banking ciphertext decrypts under the CURRENT key
 * alone (i.e. already re-keyed). Non-encrypted/empty values count as "current"
 * (nothing to do). Used by the operator field-crypto status/reencrypt endpoint.
 */
export function isBankingCiphertextOnCurrentKey(ciphertext: string | null | undefined): boolean {
  if (!ciphertext || !ciphertext.startsWith("enc:")) return true;
  try {
    decryptFieldWithSecret(ciphertext, BANKING_ENCRYPTION_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rotation tooling: re-encrypt a banking value under the CURRENT key — decrypt
 * with the dual-key fallback, then encrypt with the current key. No-op for
 * non-encrypted values.
 */
export function reencryptBankingField(ciphertext: string): string {
  if (!ciphertext || !ciphertext.startsWith("enc:")) return ciphertext;
  return encryptField(decryptField(ciphertext));
}

function encryptBankingFields(data: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...data };
  if (typeof copy.bankRoutingNumber === "string" && copy.bankRoutingNumber && BANKING_ENCRYPTION_KEY) {
    copy.bankRoutingNumber = encryptField(copy.bankRoutingNumber);
  }
  if (typeof copy.bankAccountNumber === "string" && copy.bankAccountNumber && BANKING_ENCRYPTION_KEY) {
    copy.bankAccountNumber = encryptField(copy.bankAccountNumber);
  }
  return copy;
}

function decryptBankingOnUser<T extends Record<string, unknown>>(user: T): T {
  const copy: Record<string, unknown> = { ...user };
  if (typeof copy.bankRoutingNumber === "string" && copy.bankRoutingNumber) {
    try {
      copy.bankRoutingNumber = decryptField(copy.bankRoutingNumber as string);
    } catch (err) {
      console.error(`[storage] Failed to decrypt bankRoutingNumber for user ${copy.id}:`, (err as Error).message);
      throw new Error("Failed to decrypt banking routing number — data may be corrupted", { cause: err });
    }
  }
  if (typeof copy.bankAccountNumber === "string" && copy.bankAccountNumber) {
    try {
      copy.bankAccountNumber = decryptField(copy.bankAccountNumber as string);
    } catch (err) {
      console.error(`[storage] Failed to decrypt bankAccountNumber for user ${copy.id}:`, (err as Error).message);
      throw new Error("Failed to decrypt banking account number — data may be corrupted", { cause: err });
    }
  }
  return copy as T;
}

function tryDecryptBankingOnUser<T extends Record<string, unknown>>(user: T): T {
  const copy: Record<string, unknown> = { ...user };
  if (typeof copy.bankRoutingNumber === "string" && copy.bankRoutingNumber) {
    try {
      copy.bankRoutingNumber = decryptField(copy.bankRoutingNumber as string);
    } catch (err) {
      console.error(`[storage] Failed to decrypt bankRoutingNumber for user ${copy.id}:`, (err as Error).message);
      copy.bankRoutingNumber = null;
    }
  }
  if (typeof copy.bankAccountNumber === "string" && copy.bankAccountNumber) {
    try {
      copy.bankAccountNumber = decryptField(copy.bankAccountNumber as string);
    } catch (err) {
      console.error(`[storage] Failed to decrypt bankAccountNumber for user ${copy.id}:`, (err as Error).message);
      copy.bankAccountNumber = null;
    }
  }
  return copy as T;
}

/**
 * Either the base db or an open transaction. Lets a caller run a helper on the
 * SAME connection that already holds a row lock — e.g. recompute the invoice
 * paid status inside the transaction that holds the invoice FOR UPDATE, instead
 * of on a separate pooled connection that would self-deadlock (audit #8/#14).
 */
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Thrown by linkTimeEntriesToPayout (audit #13) when one or more of the requested
 * time entries are already linked to a non-VOID payout. Callers map it to HTTP 409
 * (manual payout) or skip the team member (invoice auto-payout).
 */
export class PayoutEntriesAlreadyPaidError extends Error {
  constructor(public readonly conflictingTimeEntryIds: string[]) {
    super(`Time entries already paid in a non-void payout: ${conflictingTimeEntryIds.join(", ")}`);
    this.name = "PayoutEntriesAlreadyPaidError";
  }
}

/** Stable 31-bit advisory-lock key for serializing payout link ops per (org, member). */
function payoutMemberLockKey(orgId: string, teamMemberId: string): number {
  return Buffer.from(orgId + teamMemberId).reduce((a, b) => ((a * 31 + b) & 0x7fffffff), 0);
}

/**
 * An open drizzle transaction (the `tx` handed to `db.transaction(async (tx) => …)`).
 * A caller can thread its own transaction into a storage helper so the helper's
 * locks/writes run on the SAME connection — see `createStripePayment` (audit #20).
 */
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Result of `createStripePayment`. The Stripe path must be able to REJECT a
 * payment that would overpay the invoice (re-checked under the row lock, audit
 * #20) without throwing, so the webhook can record a terminal FAILED event and
 * return 200 to Stripe (a thrown error would trigger up-to-3-day redelivery of a
 * deterministically-failing event).
 */
export type CreateStripePaymentResult =
  | { status: "OK"; payment: Payment }
  | { status: "OVERPAYMENT"; currentPaid: number; invoiceTotal: number; attempted: number }
  | { status: "INVOICE_NOT_FOUND" };

export class DatabaseStorage {
  async isDateInClosedPeriod(orgId: string, date: string): Promise<boolean> {
    const [row] = await db
      .select({ id: closePeriods.id })
      .from(closePeriods)
      .where(
        and(
          eq(closePeriods.orgId, orgId),
          eq(closePeriods.status, "CLOSED"),
          lte(closePeriods.periodStart, date),
          gte(closePeriods.periodEnd, date),
        )
      )
      .limit(1);
    return !!row;
  }

  async createOrg(data: InsertOrg): Promise<Org> {
    const [org] = await db.insert(orgs).values(data).returning();
    return org;
  }

  async getOrg(id: string): Promise<Org | undefined> {
    const [org] = await db.select().from(orgs).where(eq(orgs.id, id));
    return org;
  }

  async getOrgByStripeCustomerId(stripeCustomerId: string): Promise<Org | undefined> {
    const [org] = await db.select().from(orgs).where(eq(orgs.stripeCustomerId, stripeCustomerId));
    return org;
  }

  async updateOrg(id: string, data: Partial<Org>) {
    const [org] = await db.update(orgs).set(data).where(eq(orgs.id, id)).returning();
    return org;
  }

  async createUser(data: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByEmailInOrg(email: string, orgId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users)
      .where(and(eq(users.email, email), eq(users.orgId, orgId)))
      .limit(1);
    return user;
  }

  async getOrgBySlug(slug: string): Promise<Org | undefined> {
    const [org] = await db.select().from(orgs).where(eq(orgs.slug, slug.toLowerCase().trim())).limit(1);
    return org;
  }

  async getUserByOrgSlugAndEmail(slug: string, email: string): Promise<User | undefined> {
    const org = await this.getOrgBySlug(slug);
    if (!org) return undefined;
    const [user] = await db.select().from(users)
      .where(and(eq(users.orgId, org.id), eq(users.email, email.toLowerCase().trim())))
      .limit(1);
    return user;
  }

  async getActiveUsersByEmail(email: string): Promise<Array<User & { orgName: string; orgSlug: string }>> {
    const rows = await db
      .select({
        user: users,
        orgName: orgs.name,
        orgSlug: orgs.slug,
      })
      .from(users)
      .innerJoin(orgs, eq(users.orgId, orgs.id))
      .where(and(
        eq(users.email, email.toLowerCase().trim()),
        eq(users.isActive, true)
      ));
    return rows.map(r => ({ ...r.user, orgName: r.orgName, orgSlug: r.orgSlug }));
  }

  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user ? decryptBankingOnUser(user as Record<string, unknown>) as User : undefined;
  }

  async getTeamMembersByOrg(orgId: string): Promise<User[]> {
    const rows = await db.select().from(users).where(eq(users.orgId, orgId));
    return rows.map(u => ({ ...u, bankAccountNumber: null, bankRoutingNumber: null, ein: null, password: "" }) as User);
  }

  async getClientsByOrg(orgId: string, pagination?: PaginationParams): Promise<Client[]> {
    const pg = paginationToLimitOffset(pagination);
    let query = db
      .select()
      .from(clients)
      .where(eq(clients.orgId, orgId))
      .orderBy(desc(clients.createdAt));
    if (pg) query = query.limit(pg.limit).offset(pg.offset) as typeof query;
    return query;
  }

  async createClient(data: InsertClient): Promise<Client> {
    const [client] = await db.insert(clients).values(data).returning();
    return client;
  }

  async getClientById(id: string, orgId: string): Promise<Client | undefined> {
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.orgId, orgId)));
    return client;
  }

  async getClient(id: string, orgId: string): Promise<Client | undefined> {
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.orgId, orgId)));
    return client;
  }

  async updateClient(id: string, orgId: string, data: Partial<InsertClient>): Promise<Client | undefined> {
    const [client] = await db
      .update(clients)
      .set(data)
      .where(and(eq(clients.id, id), eq(clients.orgId, orgId)))
      .returning();
    return client;
  }

  async getClientPortalData(token: string) {
    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.portalToken, token));
    if (!client) return undefined;

    const orgData = await this.getOrg(client.orgId);

    const portalVisibleStatuses = ["sent", "partial", "paid"];

    const allClientInvoices = await db
      .select({
        id: invoices.id,
        number: invoices.number,
        status: invoices.status,
        issuedDate: invoices.issuedDate,
        dueDate: invoices.dueDate,
        total: invoices.total,
        paidAmount: invoices.paidAmount,
        publicToken: invoices.publicToken,
      })
      .from(invoices)
      .where(and(eq(invoices.clientId, client.id), eq(invoices.orgId, client.orgId)));

    const clientInvoices = allClientInvoices.filter(inv =>
      portalVisibleStatuses.includes(inv.status.toLowerCase())
    );

    const clientEstimates = await db
      .select({
        id: estimates.id,
        number: estimates.number,
        status: estimates.status,
        issuedDate: estimates.issuedDate,
        expiryDate: estimates.expiryDate,
        total: estimates.total,
        publicToken: estimates.publicToken,
      })
      .from(estimates)
      .where(and(eq(estimates.clientId, client.id), eq(estimates.orgId, client.orgId)));

    const clientPayments = await db
      .select({
        id: payments.id,
        invoiceId: payments.invoiceId,
        amount: payments.amount,
        method: payments.method,
        date: payments.date,
        invoiceNumber: invoices.number,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(and(eq(invoices.clientId, client.id), eq(invoices.orgId, client.orgId)));

    const totalBilled = clientInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
    const totalPaid = clientInvoices.reduce((sum, inv) => sum + Number(inv.paidAmount), 0);

    return {
      client: {
        name: client.name,
        email: client.email,
        phone: client.phone,
        address: client.address,
      },
      org: orgData ? {
        name: orgData.name,
        logoUrl: orgData.logoUrl,
        email: orgData.email,
        phone: orgData.phone,
        website: orgData.website,
      } : null,
      invoices: clientInvoices,
      estimates: clientEstimates,
      payments: clientPayments,
      totalBilled: totalBilled.toFixed(2),
      totalPaid: totalPaid.toFixed(2),
      outstanding: (totalBilled - totalPaid).toFixed(2),
    };
  }

  async deleteClient(id: string, orgId: string): Promise<{ deleted: boolean; conflict?: string }> {
    const projectRefs = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.clientId, id), eq(projects.orgId, orgId))).limit(1);
    if (projectRefs.length > 0) return { deleted: false, conflict: "projects" };

    const invoiceRefs = await db.select({ id: invoices.id }).from(invoices).where(and(eq(invoices.clientId, id), eq(invoices.orgId, orgId))).limit(1);
    if (invoiceRefs.length > 0) return { deleted: false, conflict: "invoices" };

    const estimateRefs = await db.select({ id: estimates.id }).from(estimates).where(and(eq(estimates.clientId, id), eq(estimates.orgId, orgId))).limit(1);
    if (estimateRefs.length > 0) return { deleted: false, conflict: "estimates" };

    await db.delete(clientContacts).where(and(eq(clientContacts.clientId, id), eq(clientContacts.orgId, orgId)));
    await db.delete(clients).where(and(eq(clients.id, id), eq(clients.orgId, orgId)));
    return { deleted: true };
  }

  async getContactsByClient(clientId: string, orgId: string): Promise<ClientContact[]> {
    return db
      .select()
      .from(clientContacts)
      .where(and(eq(clientContacts.clientId, clientId), eq(clientContacts.orgId, orgId)))
      .orderBy(desc(clientContacts.isPrimary), asc(clientContacts.lastName));
  }

  async getContactById(id: string, orgId: string): Promise<ClientContact | undefined> {
    const [contact] = await db
      .select()
      .from(clientContacts)
      .where(and(eq(clientContacts.id, id), eq(clientContacts.orgId, orgId)));
    return contact;
  }

  // Marketing OS — Sprint 2a: legacy createContact/updateContact removed; the
  // marketing-aware versions further down in this class supersede them with
  // identical signatures plus an automatic updatedAt bump.

  async deleteContact(id: string, orgId: string): Promise<boolean> {
    const result = await db
      .delete(clientContacts)
      .where(and(eq(clientContacts.id, id), eq(clientContacts.orgId, orgId)))
      .returning();
    return result.length > 0;
  }

  async getClientNotesByClient(clientId: string, orgId: string): Promise<(ClientNote & { authorName: string | null })[]> {
    const rows = await db
      .select({ note: clientNotes, authorName: users.name })
      .from(clientNotes)
      .leftJoin(users, eq(clientNotes.authorId, users.id))
      .where(and(eq(clientNotes.clientId, clientId), eq(clientNotes.orgId, orgId)))
      .orderBy(desc(clientNotes.isPinned), desc(clientNotes.createdAt));
    return rows.map(r => ({ ...r.note, authorName: r.authorName }));
  }

  async createClientNote(data: InsertClientNote): Promise<ClientNote> {
    const [note] = await db.insert(clientNotes).values(data).returning();
    return note;
  }

  async getClientNoteById(id: string, orgId: string): Promise<ClientNote | undefined> {
    const [note] = await db
      .select()
      .from(clientNotes)
      .where(and(eq(clientNotes.id, id), eq(clientNotes.orgId, orgId)));
    return note;
  }

  async updateClientNote(id: string, orgId: string, data: Partial<ClientNote>): Promise<ClientNote | undefined> {
    const [note] = await db
      .update(clientNotes)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(clientNotes.id, id), eq(clientNotes.orgId, orgId)))
      .returning();
    return note;
  }

  async deleteClientNote(id: string, orgId: string): Promise<boolean> {
    const result = await db
      .delete(clientNotes)
      .where(and(eq(clientNotes.id, id), eq(clientNotes.orgId, orgId)))
      .returning();
    return result.length > 0;
  }

  async getClientActivitiesByClient(
    clientId: string,
    orgId: string,
    opts: { limit?: number; offset?: number; types?: string[] } = {}
  ): Promise<(ClientActivity & { userName: string | null })[]> {
    const conds = [eq(clientActivities.clientId, clientId), eq(clientActivities.orgId, orgId)];
    if (opts.types && opts.types.length > 0) {
      conds.push(inArray(clientActivities.type, opts.types));
    }
    const rows = await db
      .select({ activity: clientActivities, userName: users.name })
      .from(clientActivities)
      .leftJoin(users, eq(clientActivities.userId, users.id))
      .where(and(...conds))
      .orderBy(desc(clientActivities.createdAt))
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0);
    return rows.map(r => ({ ...r.activity, userName: r.userName }));
  }

  async createClientActivity(data: InsertClientActivity): Promise<ClientActivity> {
    const [row] = await db.insert(clientActivities).values(data).returning();
    return row;
  }

  async getClientActivityById(id: string, orgId: string): Promise<ClientActivity | undefined> {
    const [row] = await db
      .select()
      .from(clientActivities)
      .where(and(eq(clientActivities.id, id), eq(clientActivities.orgId, orgId)))
      .limit(1);
    return row;
  }

  async deleteClientActivity(id: string, orgId: string): Promise<boolean> {
    const result = await db
      .delete(clientActivities)
      .where(and(eq(clientActivities.id, id), eq(clientActivities.orgId, orgId)))
      .returning();
    return result.length > 0;
  }

  async deleteClientActivitiesByNote(noteId: string, orgId: string): Promise<number> {
    const result = await db
      .delete(clientActivities)
      .where(
        and(
          eq(clientActivities.orgId, orgId),
          eq(clientActivities.type, "NOTE_ADDED"),
          sql`${clientActivities.metadata}->>'noteId' = ${noteId}`
        )
      )
      .returning();
    return result.length;
  }

  async getBillingContactsByClient(clientId: string, orgId: string): Promise<ClientContact[]> {
    return db
      .select()
      .from(clientContacts)
      .where(
        and(
          eq(clientContacts.clientId, clientId),
          eq(clientContacts.orgId, orgId),
          sql`lower(${clientContacts.role}) = 'billing'`,
        ),
      );
  }

  async getClientDetail(id: string, orgId: string) {
    const client = await this.getClient(id, orgId);
    if (!client) return undefined;

    const clientProjects = await db.select().from(projects).where(and(eq(projects.clientId, id), eq(projects.orgId, orgId))).orderBy(desc(projects.createdAt));

    const allClientInvoices = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.clientId, id), eq(invoices.orgId, orgId)))
      .orderBy(desc(invoices.createdAt));

    const recentInvoices = allClientInvoices.slice(0, 10);

    const allPayments = await db
      .select({ amount: payments.amount })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(and(eq(invoices.clientId, id), eq(invoices.orgId, orgId)));

    const totalBilled = allClientInvoices
      .filter(inv => !["DRAFT", "VOID"].includes(inv.status))
      .reduce((sum, inv) => sum + Number(inv.total || 0), 0);

    const totalPaid = allPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const rawOutstanding = round2(totalBilled - totalPaid);
    const outstanding = Math.max(0, rawOutstanding);

    const recentEntries = await db
      .select({
        entry: timeEntries,
        projectName: projects.name,
        userName: users.name,
      })
      .from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(and(eq(projects.clientId, id), eq(projects.orgId, orgId)))
      .orderBy(desc(timeEntries.date))
      .limit(10);

    const hasOverdue = allClientInvoices.some(inv =>
      inv.status === "SENT" && inv.dueDate && new Date(inv.dueDate) < new Date()
    );

    return {
      ...client,
      projects: clientProjects,
      invoices: recentInvoices,
      recentTimeEntries: recentEntries.map(r => ({ ...r.entry, projectName: r.projectName, userName: r.userName })),
      totalBilled: round2(totalBilled),
      totalPaid: round2(totalPaid),
      outstanding,
      hasOverdue,
      hasOverpayment: rawOutstanding < 0,
    };
  }

  async getProjectsByOrg(orgId: string) {
    const rows = await db
      .select({
        project: projects,
        clientName: clients.name,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(eq(projects.orgId, orgId))
      .orderBy(desc(projects.createdAt));

    if (rows.length === 0) return [];

    const projectIds = rows.map(r => r.project.id);
    const allMembers = await db
      .select({
        member: projectMembers,
        userName: users.name,
      })
      .from(projectMembers)
      .leftJoin(users, eq(projectMembers.userId, users.id))
      .where(inArray(projectMembers.projectId, projectIds));

    const membersByProject = new Map<string, typeof allMembers>();
    for (const m of allMembers) {
      const pid = m.member.projectId;
      if (!membersByProject.has(pid)) membersByProject.set(pid, []);
      membersByProject.get(pid)!.push(m);
    }

    return rows.map(row => ({
      ...row.project,
      clientName: row.clientName || "",
      members: (membersByProject.get(row.project.id) || []).map(m => ({
        ...m.member,
        userName: m.userName || "",
      })),
    }));
  }

  async getProjectById(id: string, orgId: string): Promise<Project | undefined> {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), eq(projects.orgId, orgId)));
    return project;
  }

  async getProjectDetail(id: string, orgId: string) {
    const [projectRow] = await db
      .select({ project: projects, clientName: clients.name })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(and(eq(projects.id, id), eq(projects.orgId, orgId)));
    if (!projectRow) return undefined;

    const memberRows = await db
      .select({ member: projectMembers, userName: users.name })
      .from(projectMembers)
      .leftJoin(users, eq(projectMembers.userId, users.id))
      .where(and(eq(projectMembers.projectId, id), eq(projectMembers.orgId, orgId)));

    const members = memberRows.map(m => ({
      id: m.member.id,
      userId: m.member.userId,
      userName: m.userName || "",
      hourlyRate: m.member.hourlyRate,
      costRateHourly: m.member.costRateHourly,
      role: m.member.role,
    }));

    const entries = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.projectId, id), eq(timeEntries.orgId, orgId)));

    const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);
    const totalHoursLogged = round2(totalMinutes / 60);
    const billableEntries = entries.filter(e => e.billable);
    const billableMinutes = billableEntries.reduce((s, e) => s + e.minutes, 0);
    const billableHours = round2(billableMinutes / 60);
    const nonBillableHours = round2(totalHoursLogged - billableHours);
    const unbilledEntries = billableEntries.filter(e => !e.invoiced);
    const unbilledMinutes = unbilledEntries.reduce((s, e) => s + e.minutes, 0);
    const unbilledHours = round2(unbilledMinutes / 60);
    const unbilledAmount = round2(unbilledEntries.reduce((s, e) => s + (e.minutes / 60) * Number(e.rate), 0));

    const invoiceLineIds = entries.filter(e => e.invoiceLineId).map(e => e.invoiceLineId!);
    let projectInvoiceIds: string[] = [];
    if (invoiceLineIds.length > 0) {
      const lineRows = await db
        .select({ invoiceId: invoiceLines.invoiceId })
        .from(invoiceLines)
        .where(sql`${invoiceLines.id} IN (${sql.join(invoiceLineIds.map(lid => sql`${lid}`), sql`, `)})`);
      projectInvoiceIds = Array.from(new Set(lineRows.map(r => r.invoiceId)));
    }

    let projectInvoices: any[] = [];
    let totalInvoiced = 0;
    let totalPaid = 0;
    if (projectInvoiceIds.length > 0) {
      const invRows = await db
        .select({ invoice: invoices, clientName: clients.name })
        .from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .where(sql`${invoices.id} IN (${sql.join(projectInvoiceIds.map(iid => sql`${iid}`), sql`, `)})`);
      projectInvoices = invRows.map(r => ({
        id: r.invoice.id,
        number: r.invoice.number,
        issuedDate: r.invoice.issuedDate,
        total: r.invoice.total,
        paidAmount: r.invoice.paidAmount,
        status: r.invoice.status,
        clientName: r.clientName || "",
      }));
      totalInvoiced = round2(invRows.reduce((s, r) => s + Number(r.invoice.total), 0));
      totalPaid = round2(invRows.reduce((s, r) => s + Number(r.invoice.paidAmount), 0));
    }
    const totalOutstanding = round2(totalInvoiced - totalPaid);

    const budgetHours = projectRow.project.budgetHours ? Number(projectRow.project.budgetHours) : null;
    const budgetUsedPercent = budgetHours ? round2((totalHoursLogged / budgetHours) * 100) : null;
    const budgetRemaining = budgetHours ? round2(budgetHours - totalHoursLogged) : null;
    const overBudgetHours = budgetHours ? round2(Math.max(0, totalHoursLogged - budgetHours)) : 0;

    let daysUntilDue: number | null = null;
    if (projectRow.project.endDate) {
      const end = new Date(projectRow.project.endDate + "T12:00:00");
      const now = new Date();
      daysUntilDue = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    const hoursByMemberMap = new Map<string, { userId: string; userName: string; billableHours: number; nonBillableHours: number; totalHours: number }>();
    for (const e of entries) {
      const h = e.minutes / 60;
      const existing = hoursByMemberMap.get(e.userId);
      const memberName = memberRows.find(m => m.member.userId === e.userId)?.userName || "";
      if (existing) {
        existing.totalHours += h;
        if (e.billable) existing.billableHours += h;
        else existing.nonBillableHours += h;
      } else {
        hoursByMemberMap.set(e.userId, {
          userId: e.userId,
          userName: memberName || e.userId,
          billableHours: e.billable ? h : 0,
          nonBillableHours: e.billable ? 0 : h,
          totalHours: h,
        });
      }
    }
    const hoursByMember = Array.from(hoursByMemberMap.values()).map(h => ({
      ...h,
      billableHours: round2(h.billableHours),
      nonBillableHours: round2(h.nonBillableHours),
      totalHours: round2(h.totalHours),
    })).sort((a, b) => b.totalHours - a.totalHours);

    const userNameMap = new Map<string, string>();
    for (const m of memberRows) userNameMap.set(m.member.userId, m.userName || "");

    const allUsers = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.orgId, orgId));
    for (const u of allUsers) userNameMap.set(u.id, u.name);

    const serviceIds = Array.from(new Set(entries.filter(e => e.serviceId).map(e => e.serviceId!)));
    const serviceMap = new Map<string, string>();
    if (serviceIds.length > 0) {
      const svcRows = await db.select().from(services).where(eq(services.orgId, orgId));
      for (const s of svcRows) serviceMap.set(s.id, s.name);
    }

    const recentTimeEntries = entries
      .sort((a, b) => b.date.localeCompare(a.date) || (b.startTime || "").localeCompare(a.startTime || ""))
      .slice(0, 50)
      .map(e => ({
        id: e.id,
        date: e.date,
        startTime: e.startTime,
        endTime: e.endTime,
        minutes: e.minutes,
        userId: e.userId,
        userName: userNameMap.get(e.userId) || "",
        serviceName: e.serviceId ? (serviceMap.get(e.serviceId) || "") : "",
        notes: e.notes,
        billable: e.billable,
        invoiced: e.invoiced,
        rate: e.rate,
      }));

    const serviceHoursMap = new Map<string, number>();
    for (const e of entries) {
      if (e.serviceId) {
        serviceHoursMap.set(e.serviceId, (serviceHoursMap.get(e.serviceId) || 0) + e.minutes / 60);
      }
    }
    const svcList = Array.from(serviceHoursMap.entries()).map(([sid, h]) => ({
      id: sid,
      name: serviceMap.get(sid) || "",
      hoursLogged: round2(h),
    })).sort((a, b) => b.hoursLogged - a.hoursLogged);

    const assignedServiceRows = await db
      .select({
        id: projectServices.id,
        serviceId: projectServices.serviceId,
        serviceName: services.name,
        rateOverride: projectServices.rateOverride,
        defaultRate: services.defaultRate,
      })
      .from(projectServices)
      .innerJoin(services, eq(projectServices.serviceId, services.id))
      .where(and(eq(projectServices.projectId, id), eq(projectServices.orgId, orgId)));

    const estimateRows = await db
      .select()
      .from(estimates)
      .where(and(eq(estimates.clientId, projectRow.project.clientId), eq(estimates.orgId, orgId)));
    const projectEstimates = estimateRows.map(e => ({
      id: e.id,
      number: e.number,
      issuedDate: e.issuedDate,
      total: e.total,
      status: e.status,
    }));

    return {
      project: {
        ...projectRow.project,
        clientName: projectRow.clientName || "",
      },
      members,
      stats: {
        totalHoursLogged,
        billableHours,
        nonBillableHours,
        unbilledHours,
        unbilledAmount,
        totalInvoiced,
        totalPaid,
        totalOutstanding,
        budgetHours,
        budgetUsedPercent,
        budgetRemaining,
        daysUntilDue,
        overBudgetHours,
      },
      hoursByMember,
      recentTimeEntries,
      invoices: projectInvoices,
      estimates: projectEstimates,
      services: svcList,
      assignedServices: assignedServiceRows,
    };
  }

  async createProject(data: InsertProject): Promise<Project> {
    const [project] = await db.insert(projects).values(data).returning();
    return project;
  }

  async updateProject(id: string, orgId: string, data: Partial<{ name: string; description: string | null; status: "ACTIVE" | "COMPLETED" | "ON_HOLD" | "ARCHIVED"; budgetHours: string | null; startDate: string | null; endDate: string | null }>): Promise<Project | undefined> {
    const [project] = await db
      .update(projects)
      .set(data)
      .where(and(eq(projects.id, id), eq(projects.orgId, orgId)))
      .returning();
    return project;
  }

  async deleteProject(id: string, orgId: string): Promise<{ deleted: boolean; conflict?: string }> {
    const entryRefs = await db.select({ id: timeEntries.id }).from(timeEntries).where(and(eq(timeEntries.projectId, id), eq(timeEntries.orgId, orgId))).limit(1);
    if (entryRefs.length > 0) return { deleted: false, conflict: "time entries" };

    await db.delete(projectServices).where(and(eq(projectServices.projectId, id), eq(projectServices.orgId, orgId)));
    await db.delete(projectMembers).where(and(eq(projectMembers.projectId, id), eq(projectMembers.orgId, orgId)));
    await db.delete(projects).where(and(eq(projects.id, id), eq(projects.orgId, orgId)));
    return { deleted: true };
  }

  async duplicateProject(id: string, orgId: string): Promise<{ project: Project; members: ProjectMember[] } | undefined> {
    const [source] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.orgId, orgId)));
    if (!source) return undefined;
    const [newProject] = await db.insert(projects).values({
      orgId,
      clientId: source.clientId,
      name: source.name + " (Copy)",
      description: source.description,
      budgetHours: source.budgetHours,
      startDate: source.startDate,
      endDate: source.endDate,
      status: "ACTIVE" as any,
    }).returning();
    const sourceMembers = await db.select().from(projectMembers).where(eq(projectMembers.projectId, id));
    const newMembers: ProjectMember[] = [];
    for (const m of sourceMembers) {
      const [nm] = await db.insert(projectMembers).values({
        orgId,
        projectId: newProject.id,
        userId: m.userId,
        hourlyRate: m.hourlyRate,
        costRateHourly: m.costRateHourly,
      }).returning();
      newMembers.push(nm);
    }
    return { project: newProject, members: newMembers };
  }

  async removeProjectMember(projectId: string, memberId: string, orgId: string): Promise<boolean> {
    const result = await db.delete(projectMembers).where(and(eq(projectMembers.id, memberId), eq(projectMembers.projectId, projectId), eq(projectMembers.orgId, orgId)));
    return (result.rowCount ?? 0) > 0;
  }

  async getServicesByOrg(orgId: string): Promise<Service[]> {
    return db
      .select()
      .from(services)
      .where(eq(services.orgId, orgId))
      .orderBy(asc(services.name));
  }

  async getServiceById(id: string, orgId: string): Promise<Service | undefined> {
    const [service] = await db
      .select()
      .from(services)
      .where(and(eq(services.id, id), eq(services.orgId, orgId)));
    return service;
  }

  async createService(data: InsertService): Promise<Service> {
    const [service] = await db.insert(services).values(data).returning();
    return service;
  }

  async updateService(
    id: string,
    orgId: string,
    data: Partial<{ name: string; description: string | null; defaultRate: string | null; isActive: boolean }>,
  ): Promise<Service | undefined> {
    const [updated] = await db
      .update(services)
      .set(data)
      .where(and(eq(services.id, id), eq(services.orgId, orgId)))
      .returning();
    return updated;
  }

  async addProjectMember(data: InsertProjectMember): Promise<ProjectMember> {
    const [member] = await db
      .insert(projectMembers)
      .values(data)
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: {
          hourlyRate: sql`GREATEST(${projectMembers.hourlyRate}, EXCLUDED.hourly_rate)`,
          costRateHourly: sql`GREATEST(${projectMembers.costRateHourly}, EXCLUDED.cost_rate_hourly)`,
        },
      })
      .returning();
    return member;
  }

  async getProjectMembership(
    projectId: string,
    userId: string,
  ): Promise<ProjectMember | undefined> {
    const [member] = await db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
        ),
      );
    return member;
  }

  async getUserProjects(userId: string, orgId: string) {
    const rows = await db
      .select({
        projectId: projectMembers.projectId,
        projectName: projects.name,
        projectDescription: projects.description,
        projectStatus: projects.status,
        clientId: projects.clientId,
        clientName: clients.name,
        rate: projectMembers.hourlyRate,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(projectMembers.userId, userId),
          eq(projects.orgId, orgId),
        ),
      );
    return rows.map((r) => ({
      id: r.projectId,
      name: r.projectName,
      description: r.projectDescription,
      status: r.projectStatus,
      clientId: r.clientId,
      clientName: r.clientName || "",
      rate: r.rate,
      orgId,
      members: [],
      createdAt: new Date(),
    }));
  }

  async getTimeEntriesByOrg(orgId: string) {
    return db
      .select({
        entry: timeEntries,
        projectName: projects.name,
        clientName: clients.name,
        userName: users.name,
        serviceName: services.name,
      })
      .from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .leftJoin(services, eq(timeEntries.serviceId, services.id))
      .where(eq(timeEntries.orgId, orgId))
      .orderBy(desc(timeEntries.date), desc(timeEntries.createdAt))
      .limit(5000)
      .then((rows) =>
        rows.map((r) => ({
          ...r.entry,
          projectName: r.projectName,
          clientName: r.clientName || "",
          userName: r.userName,
          serviceName: r.serviceName || null,
        })),
      );
  }

  async getTimeEntriesByUser(orgId: string, userId: string) {
    return db
      .select({
        entry: timeEntries,
        projectName: projects.name,
        clientName: clients.name,
        userName: users.name,
        serviceName: services.name,
        memberCostRate: projectMembers.costRateHourly,
        userHourlyPayRate: users.hourlyPayRate,
      })
      .from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .leftJoin(services, eq(timeEntries.serviceId, services.id))
      .leftJoin(projectMembers, and(eq(projectMembers.projectId, timeEntries.projectId), eq(projectMembers.userId, timeEntries.userId)))
      .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.userId, userId)))
      .orderBy(desc(timeEntries.date), desc(timeEntries.createdAt))
      .limit(5000)
      .then((rows) =>
        rows.map((r) => ({
          ...r.entry,
          projectName: r.projectName,
          clientName: r.clientName || "",
          userName: r.userName,
          serviceName: r.serviceName || null,
          costRate: r.entry.costRateSnapshot ?? r.memberCostRate ?? r.userHourlyPayRate ?? null,
        })),
      );
  }

  async createTimeEntry(data: InsertTimeEntry, costRateSnapshot?: string): Promise<TimeEntry> {
    if (data.date && data.orgId) {
      if (await this.isDateInClosedPeriod(data.orgId, data.date)) {
        throw new Error(`Period is closed — cannot modify ${data.date}`);
      }
    }
    const [entry] = await db.insert(timeEntries).values({ ...data, costRateSnapshot: costRateSnapshot ?? null }).returning();
    return entry;
  }

  async getUnbilledTimeForClient(orgId: string, clientId: string) {
    return db
      .select({
        entry: timeEntries,
        projectName: projects.name,
        userName: users.name,
        serviceName: services.name,
      })
      .from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .leftJoin(services, eq(timeEntries.serviceId, services.id))
      .where(
        and(
          eq(timeEntries.orgId, orgId),
          eq(projects.clientId, clientId),
          eq(timeEntries.billable, true),
          eq(timeEntries.invoiced, false),
        ),
      )
      .orderBy(asc(timeEntries.date));
  }

  async getUnbilledTimeEntries(orgId: string, clientId: string) {
    return db
      .select({
        id: timeEntries.id,
        userId: timeEntries.userId,
        date: timeEntries.date,
        minutes: timeEntries.minutes,
        notes: timeEntries.notes,
        rate: timeEntries.rate,
        projectName: projects.name,
        userName: users.name,
        serviceName: services.name,
        billRate: projectMembers.hourlyRate,
      })
      .from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .leftJoin(services, eq(timeEntries.serviceId, services.id))
      .leftJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, timeEntries.projectId),
          eq(projectMembers.userId, timeEntries.userId),
        ),
      )
      .where(
        and(
          eq(timeEntries.orgId, orgId),
          eq(projects.clientId, clientId),
          eq(timeEntries.billable, true),
          eq(timeEntries.invoiced, false),
        ),
      )
      .orderBy(asc(timeEntries.date));
  }

  async markTimeEntriesInvoiced(entryIds: string[], lineId: string, orgId: string) {
    if (!entryIds.length) return;
    for (const id of entryIds) {
      const result = await db
        .update(timeEntries)
        .set({ invoiced: true, invoiceLineId: lineId })
        .where(and(eq(timeEntries.id, id), eq(timeEntries.orgId, orgId), eq(timeEntries.invoiced, false)))
        .returning();
      if (!result.length) {
        console.warn(`[invoicing] Time entry ${id} already invoiced or not found — skipping`);
      }
    }
  }

  async getInvoicesByOrg(orgId: string, pagination?: PaginationParams) {
    const pg = paginationToLimitOffset(pagination);
    let query = db
      .select({
        invoice: invoices,
        clientName: clients.name,
        clientEmail: clients.email,
        clientLogoUrl: clients.logoUrl,
      })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(eq(invoices.orgId, orgId))
      .orderBy(desc(invoices.createdAt));
    if (pg) query = query.limit(pg.limit).offset(pg.offset) as typeof query;
    const rows = await query;

    if (rows.length === 0) return [];

    const invoiceIds = rows.map(r => r.invoice.id);
    const allLines = await db
      .select()
      .from(invoiceLines)
      .where(inArray(invoiceLines.invoiceId, invoiceIds))
      .orderBy(asc(invoiceLines.sortOrder));

    const linesByInvoice = new Map<string, typeof allLines>();
    for (const line of allLines) {
      if (!linesByInvoice.has(line.invoiceId)) linesByInvoice.set(line.invoiceId, []);
      linesByInvoice.get(line.invoiceId)!.push(line);
    }

    return rows.map(row => ({
      ...row.invoice,
      clientName: row.clientName || "",
      clientEmail: row.clientEmail || "",
      clientLogoUrl: row.clientLogoUrl || null,
      lines: linesByInvoice.get(row.invoice.id) || [],
    }));
  }

  async getInvoiceCount(orgId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .where(eq(invoices.orgId, orgId));
    return Number(result?.count) || 0;
  }

  async getClientCount(orgId: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(clients)
      .where(eq(clients.orgId, orgId));
    return Number(result?.count) || 0;
  }

  async getInvoice(id: string, orgId: string) {
    const [row] = await db
      .select({
        invoice: invoices,
        clientName: clients.name,
        clientEmail: clients.email,
        clientLogoUrl: clients.logoUrl,
      })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(eq(invoices.id, id), eq(invoices.orgId, orgId)));

    if (!row) return undefined;

    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, row.invoice.id))
      .orderBy(asc(invoiceLines.sortOrder));

    return {
      ...row.invoice,
      clientName: row.clientName || "",
      clientEmail: row.clientEmail || "",
      clientLogoUrl: row.clientLogoUrl || null,
      lines,
    };
  }

  async duplicateInvoice(id: string, orgId: string): Promise<any> {
    const source = await this.getInvoice(id, orgId);
    if (!source) return undefined;
    const newNumber = await this.getNextInvoiceNumber(orgId);
    const [newInvoice] = await db.insert(invoices).values({
      orgId,
      clientId: source.clientId,
      number: newNumber,
      status: "DRAFT" as any,
      issuedDate: new Date().toISOString().split("T")[0],
      dueDate: source.dueDate || new Date().toISOString().split("T")[0],
      subtotal: source.subtotal,
      discountType: source.discountType,
      discountValue: source.discountValue,
      discountAmount: source.discountAmount,
      taxRate: source.taxRate,
      taxAmount: source.taxAmount,
      total: source.total,
      paidAmount: "0",
      notes: source.notes,
    }).returning();
    for (const line of source.lines) {
      await db.insert(invoiceLines).values({
        orgId,
        invoiceId: newInvoice.id,
        description: line.description,
        quantity: line.quantity,
        unitRate: line.unitRate,
        amount: line.amount,
        sortOrder: line.sortOrder,
        isHeader: line.isHeader,
      });
    }
    return this.getInvoice(newInvoice.id, orgId);
  }

  async createInvoice(data: InsertInvoice): Promise<Invoice> {
    if (data.issuedDate && data.orgId) {
      if (await this.isDateInClosedPeriod(data.orgId, data.issuedDate)) {
        throw new Error(`Period is closed — cannot modify ${data.issuedDate}`);
      }
    }
    const [invoice] = await db.insert(invoices).values(data).returning();
    return invoice;
  }

  private async guardInvoiceLinePeriod(invoiceId: string, orgId: string): Promise<void> {
    const inv = await this.getInvoice(invoiceId, orgId);
    if (inv?.issuedDate && await this.isDateInClosedPeriod(orgId, inv.issuedDate)) {
      throw new Error(`Period is closed — cannot modify ${inv.issuedDate}`);
    }
  }

  async createInvoiceLine(data: InsertInvoiceLine): Promise<InvoiceLine> {
    if (data.invoiceId && data.orgId) {
      await this.guardInvoiceLinePeriod(data.invoiceId, data.orgId);
    }
    const [line] = await db.insert(invoiceLines).values(data).returning();
    return line;
  }

  async updateInvoiceLine(
    lineId: string,
    data: { description: string; quantity: string; unitRate: string; amount: string },
    orgId: string,
  ): Promise<InvoiceLine> {
    const [existingLine] = await db.select().from(invoiceLines).where(and(eq(invoiceLines.id, lineId), eq(invoiceLines.orgId, orgId)));
    if (existingLine) await this.guardInvoiceLinePeriod(existingLine.invoiceId, orgId);
    const [line] = await db
      .update(invoiceLines)
      .set(data)
      .where(and(eq(invoiceLines.id, lineId), eq(invoiceLines.orgId, orgId)))
      .returning();
    return line;
  }

  async deleteInvoiceLine(lineId: string, orgId: string): Promise<void> {
    const [existingLine] = await db.select().from(invoiceLines).where(and(eq(invoiceLines.id, lineId), eq(invoiceLines.orgId, orgId)));
    if (existingLine) await this.guardInvoiceLinePeriod(existingLine.invoiceId, orgId);
    await db
      .update(timeEntries)
      .set({ invoiced: false, invoiceLineId: null })
      .where(and(eq(timeEntries.invoiceLineId, lineId), eq(timeEntries.orgId, orgId)));

    await db
      .update(expenses)
      .set({ invoiced: false, invoiceLineId: null })
      .where(and(eq(expenses.invoiceLineId, lineId), eq(expenses.orgId, orgId)));

    await db.delete(invoiceLines).where(and(eq(invoiceLines.id, lineId), eq(invoiceLines.orgId, orgId)));
  }

  async deleteInvoice(invoiceId: string, orgId: string): Promise<{ deleted: boolean; error?: string }> {
    return db.transaction(async (tx) => {
      const lockedRows = await tx.execute(
        sql`SELECT * FROM ${invoices} WHERE id = ${invoiceId} AND org_id = ${orgId} FOR UPDATE`
      );
      const invoice = lockedRows.rows?.[0] as any;
      if (!invoice) return { deleted: false, error: "Invoice not found" };

      if (invoice.issued_date && await this.isDateInClosedPeriod(orgId, invoice.issued_date)) {
        return { deleted: false, error: `Period is closed — cannot modify ${invoice.issued_date}` };
      }

      if (invoice.status !== "DRAFT") {
        return { deleted: false, error: "Cannot delete a sent invoice — void it instead" };
      }

      const paymentRows = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.invoiceId, invoiceId), eq(payments.orgId, orgId)))
        .limit(1);
      if (paymentRows.length > 0) {
        return { deleted: false, error: "Cannot delete an invoice with payments — void it instead" };
      }

      await tx
        .update(timeEntries)
        .set({ invoiced: false, invoiceLineId: null })
        .where(
          and(
            eq(timeEntries.orgId, orgId),
            inArray(
              timeEntries.invoiceLineId,
              tx
                .select({ id: invoiceLines.id })
                .from(invoiceLines)
                .where(and(eq(invoiceLines.invoiceId, invoiceId), eq(invoiceLines.orgId, orgId))),
            ),
          ),
        );

      await tx
        .update(expenses)
        .set({ invoiced: false, invoiceLineId: null })
        .where(
          and(
            eq(expenses.orgId, orgId),
            inArray(
              expenses.invoiceLineId,
              tx
                .select({ id: invoiceLines.id })
                .from(invoiceLines)
                .where(and(eq(invoiceLines.invoiceId, invoiceId), eq(invoiceLines.orgId, orgId))),
            ),
          ),
        );

      await tx.delete(invoiceLines).where(and(eq(invoiceLines.invoiceId, invoiceId), eq(invoiceLines.orgId, orgId)));

      await tx.delete(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)));

      return { deleted: true };
    });
  }

  async getInvoiceLineById(lineId: string, orgId: string): Promise<InvoiceLine | undefined> {
    const [line] = await db
      .select({ invoiceLine: invoiceLines })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
      .where(and(eq(invoiceLines.id, lineId), eq(invoices.orgId, orgId)));
    return line?.invoiceLine;
  }

  async recalcInvoiceTotals(invoiceId: string, orgId: string) {
    const [invoice] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)));
    if (!invoice) return;

    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
    const taxMode = org?.taxCalculationMode || "tax_after_discount";

    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId));

    const { subtotal, discountAmount, taxAmount, total } =
      computeInvoiceTotals(
        lines,
        invoice.discountType,
        Number(invoice.discountValue),
        Number(invoice.taxRate),
        taxMode,
      );

    await db
      .update(invoices)
      .set({
        subtotal: subtotal.toFixed(2),
        discountAmount: discountAmount.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        total: total.toFixed(2),
      })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)));
  }

  async updateInvoiceTotal(invoiceId: string, orgId: string) {
    await this.recalcInvoiceTotals(invoiceId, orgId);
  }

  async updateInvoiceDiscountTax(
    invoiceId: string,
    orgId: string,
    discountType: string,
    discountValue: number,
    taxRate: number,
  ) {
    await db
      .update(invoices)
      .set({
        discountType,
        discountValue: discountValue.toFixed(2),
        taxRate: taxRate.toFixed(2),
      })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)));

    await this.recalcInvoiceTotals(invoiceId, orgId);
  }

  async updateInvoiceNotes(invoiceId: string, orgId: string, notes: string | null) {
    await db
      .update(invoices)
      .set({ notes })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)));
  }

  async updateInvoiceStatus(invoiceId: string, status: string, orgId: string) {
    const inv = await this.getInvoice(invoiceId, orgId);
    if (inv?.issuedDate && await this.isDateInClosedPeriod(orgId, inv.issuedDate)) {
      throw new Error(`Period is closed — cannot modify ${inv.issuedDate}`);
    }
    await db
      .update(invoices)
      .set({ status: status as any })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)));
  }

  async setInvoicePublicToken(invoiceId: string, token: string, orgId: string) {
    await db
      .update(invoices)
      .set({ publicToken: token })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)));
  }

  async getInvoiceByPublicToken(token: string) {
    const [row] = await db
      .select({
        invoice: invoices,
        clientName: clients.name,
        clientEmail: clients.email,
        clientLogoUrl: clients.logoUrl,
      })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(eq(invoices.publicToken, token));

    if (!row) return undefined;

    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, row.invoice.id))
      .orderBy(asc(invoiceLines.sortOrder));

    return {
      ...row.invoice,
      clientName: row.clientName || "",
      clientEmail: row.clientEmail || "",
      clientLogoUrl: row.clientLogoUrl || null,
      lines,
    };
  }

  async getInvoiceRevisions(invoiceId: string) {
    return db
      .select()
      .from(invoiceRevisions)
      .where(eq(invoiceRevisions.invoiceId, invoiceId))
      .orderBy(desc(invoiceRevisions.revisionNumber));
  }

  async getNextRevisionNumber(invoiceId: string): Promise<number> {
    const [result] = await db
      .select({ maxNum: sql<number>`COALESCE(MAX(${invoiceRevisions.revisionNumber}), 0)` })
      .from(invoiceRevisions)
      .where(eq(invoiceRevisions.invoiceId, invoiceId));
    return (result?.maxNum ?? 0) + 1;
  }

  async createInvoiceRevision(
    invoiceId: string,
    snapshot: any,
    reason: string,
    orgId?: string,
    createdByUserId?: string,
  ) {
    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("Invalid revision snapshot: must be an object");
    }
    if (snapshot.total === undefined || snapshot.total === null) {
      throw new Error("Invalid revision snapshot: missing required field 'total'");
    }
    if (snapshot.subtotal === undefined || snapshot.subtotal === null) {
      throw new Error("Invalid revision snapshot: missing required field 'subtotal'");
    }
    if (!Array.isArray(snapshot.lines)) {
      throw new Error("Invalid revision snapshot: missing required field 'lines' (array)");
    }
    const revisionNumber = await this.getNextRevisionNumber(invoiceId);
    const values: any = {
      invoiceId,
      revisionNumber,
      snapshot,
      reason,
    };
    if (orgId) values.orgId = orgId;
    if (createdByUserId) values.createdByUserId = createdByUserId;
    const [rev] = await db.insert(invoiceRevisions).values(values).returning();
    return rev;
  }

  async getNextInvoiceNumber(orgId: string): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT number FROM invoices WHERE org_id = $1 FOR UPDATE', [orgId]);
      const org = await this.getOrg(orgId);
      const prefix = org?.invoicePrefix || "INV-";
      let maxNum = 0;
      const existingNumbers = new Set<string>();
      for (const row of result.rows) {
        existingNumbers.add(row.number);
        if (row.number && row.number.startsWith(prefix)) {
          const match = row.number.slice(prefix.length).match(/^(\d+)$/);
          if (match) { const num = parseInt(match[1], 10); if (num > maxNum) maxNum = num; }
        }
      }
      let nextNum = maxNum + 1;
      let candidate = `${prefix}${String(nextNum).padStart(4, "0")}`;
      while (existingNumbers.has(candidate)) { nextNum++; candidate = `${prefix}${String(nextNum).padStart(4, "0")}`; }
      await client.query('COMMIT');
      return candidate;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getOutstandingAR(orgId: string): Promise<number> {
    const [result] = await db
      .select({
        total: sql<number>`coalesce(sum((cast(${invoices.total} as numeric) - cast(${invoices.paidAmount} as numeric)) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0)`,
      })
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), ne(invoices.status, "VOID"), ne(invoices.status, "DRAFT")));
    return round2(Number(result?.total || 0));
  }

  async getServiceRevenue(orgId: string, startDate: string, endDate: string): Promise<number> {
    const [result] = await db
      .select({
        total: sql<number>`coalesce(sum(cast(${invoices.subtotal} as numeric) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0)`,
      })
      .from(invoices)
      .where(and(
        eq(invoices.orgId, orgId),
        ne(invoices.status, "VOID"),
        ne(invoices.status, "DRAFT"),
        gte(invoices.issuedDate, startDate),
        lte(invoices.issuedDate, endDate),
      ));
    return round2(Number(result?.total || 0));
  }

  async getServiceRevenueByMonth(orgId: string, startDate: string, endDate: string): Promise<Array<{ month: string; invoiced: number }>> {
    const rows = await db
      .select({
        month: sql<string>`to_char(${invoices.issuedDate}::date, 'YYYY-MM')`,
        invoiced: sql<number>`coalesce(sum(cast(${invoices.subtotal} as numeric) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0)`,
      })
      .from(invoices)
      .where(and(
        eq(invoices.orgId, orgId),
        ne(invoices.status, "VOID"),
        ne(invoices.status, "DRAFT"),
        gte(invoices.issuedDate, startDate),
        lte(invoices.issuedDate, endDate),
      ))
      .groupBy(sql`to_char(${invoices.issuedDate}::date, 'YYYY-MM')`)
      .orderBy(sql`to_char(${invoices.issuedDate}::date, 'YYYY-MM')`);
    return rows.map(r => ({ month: r.month, invoiced: round2(Number(r.invoiced)) }));
  }

  async getCollected(orgId: string, startDate: string, endDate: string): Promise<number> {
    const [result] = await db
      .select({
        total: sql<number>`coalesce(sum(cast(${payments.amount} as numeric) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0)`,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(and(
        eq(invoices.orgId, orgId),
        gte(payments.date, startDate),
        lte(payments.date, endDate),
      ));
    return round2(Number(result?.total || 0));
  }

  async getCollectedByMonth(orgId: string, startDate: string, endDate: string): Promise<Array<{ month: string; collected: number }>> {
    const rows = await db
      .select({
        month: sql<string>`to_char(${payments.date}::date, 'YYYY-MM')`,
        collected: sql<number>`coalesce(sum(cast(${payments.amount} as numeric) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0)`,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .where(and(
        eq(invoices.orgId, orgId),
        gte(payments.date, startDate),
        lte(payments.date, endDate),
      ))
      .groupBy(sql`to_char(${payments.date}::date, 'YYYY-MM')`)
      .orderBy(sql`to_char(${payments.date}::date, 'YYYY-MM')`);
    return rows.map(r => ({ month: r.month, collected: round2(Number(r.collected)) }));
  }

  async getActiveTeamCount(orgId: string): Promise<{ total: number; active: number; independents: number; employees: number }> {
    const [result] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${users.isActive} and ${users.name} not like 'Former User%')::int`,
        independents: sql<number>`count(*) filter (where ${users.isActive} and ${users.name} not like 'Former User%' and ${users.workerType} != 'W2_EMPLOYEE' and ${users.role} = 'TEAM_MEMBER')::int`,
        employees: sql<number>`count(*) filter (where ${users.isActive} and ${users.name} not like 'Former User%' and ${users.workerType} = 'W2_EMPLOYEE')::int`,
      })
      .from(users)
      .where(eq(users.orgId, orgId));
    return {
      total: Number(result?.total || 0),
      active: Number(result?.active || 0),
      independents: Number(result?.independents || 0),
      employees: Number(result?.employees || 0),
    };
  }

  async getActiveTeamMembersList(orgId: string): Promise<Array<{ id: string; name: string; role: string; workerType: string }>> {
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        workerType: users.workerType,
      })
      .from(users)
      .where(and(
        eq(users.orgId, orgId),
        eq(users.isActive, true),
        sql`${users.name} not like 'Former User%'`,
      ))
      .orderBy(users.name);
    return rows.map(r => ({ id: r.id, name: r.name, role: r.role, workerType: r.workerType }));
  }

  async getUnpaidInvoices(orgId: string) {
    return db
      .select({
        invoice: invoices,
        clientName: clients.name,
      })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(
        and(
          eq(invoices.orgId, orgId),
          ne(invoices.status, "PAID"),
          ne(invoices.status, "VOID"),
          ne(invoices.status, "DRAFT"),
        ),
      )
      .then((rows) =>
        rows.map((r) => ({ ...r.invoice, clientName: r.clientName || "" })),
      );
  }

  async getPayment(paymentId: string, orgId: string) {
    const [payment] = await db.select().from(payments).where(
      and(eq(payments.id, paymentId), eq(payments.orgId, orgId))
    );
    return payment || undefined;
  }

  async getPaymentsByOrg(orgId: string, pagination?: PaginationParams) {
    const pg = paginationToLimitOffset(pagination);
    let query = db
      .select({
        payment: payments,
        invoiceNumber: invoices.number,
        clientName: clients.name,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(eq(payments.orgId, orgId))
      .orderBy(desc(payments.createdAt));
    if (pg) query = query.limit(pg.limit).offset(pg.offset) as typeof query;
    return query.then((rows) =>
        rows.map((r) => ({
          ...r.payment,
          invoiceNumber: r.invoiceNumber,
          clientName: r.clientName || "",
        })),
      );
  }

  async createPayment(data: InsertPayment): Promise<Payment> {
    return db.transaction(async (tx) => {
      const lockedRows = await tx.execute(
        sql`SELECT * FROM ${invoices} WHERE id = ${data.invoiceId} AND org_id = ${data.orgId} FOR UPDATE`
      );
      const invoice = lockedRows.rows?.[0] as any;

      if (!invoice) {
        throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
      }
      if (invoice.status === "DRAFT" || invoice.status === "VOID") {
        throw Object.assign(new Error(`Cannot record payment for a ${invoice.status.toLowerCase()} invoice`), { statusCode: 400 });
      }
      if (invoice.status === "PAID") {
        throw Object.assign(new Error("Invoice is already fully paid"), { statusCode: 400 });
      }

      const outstanding = round2(Number(invoice.total) - Number(invoice.paid_amount));
      const paymentAmount = round2(Number(data.amount));
      if (paymentAmount > outstanding) {
        throw Object.assign(new Error(`Payment amount exceeds outstanding balance ($${outstanding.toFixed(2)})`), { statusCode: 400 });
      }

      const [payment] = await tx.insert(payments).values(data).returning();

      const newPaid = round2(Number(invoice.paid_amount) + paymentAmount);
      const invoiceTotal = Number(invoice.total);
      const newStatus = newPaid >= invoiceTotal ? "PAID" : "PARTIAL";
      await tx
        .update(invoices)
        .set({
          paidAmount: newPaid.toFixed(2),
          status: newStatus as any,
        })
        .where(and(eq(invoices.id, data.invoiceId), eq(invoices.orgId, data.orgId)));

      return payment;
    });
  }

  async refundPayment(paymentId: string, orgId: string): Promise<{ refund: Payment; invoice: Invoice } | { error: string }> {
    return db.transaction(async (tx) => {
      const [payment] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.orgId, orgId)));
      if (!payment) return { error: "Payment not found" };
      if (payment.provider !== "MANUAL") return { error: "Cannot refund Stripe payment — use Stripe dashboard" };

      const lockedRows = await tx.execute(
        sql`SELECT * FROM ${invoices} WHERE id = ${payment.invoiceId} AND org_id = ${orgId} FOR UPDATE`
      );
      const invoice = lockedRows.rows?.[0] as any;

      if (invoice && invoice.status === "VOID") {
        throw new Error("Cannot refund payment on a voided invoice");
      }

      const refundAmount = round2(-Math.abs(Number(payment.amount)));
      const [refund] = await tx.insert(payments).values({
        orgId,
        invoiceId: payment.invoiceId,
        amount: refundAmount.toFixed(2),
        date: new Date().toISOString().split("T")[0],
        method: payment.method,
        provider: "MANUAL" as any,
        notes: `Refund of ${payment.method} payment $${Math.abs(Number(payment.amount)).toFixed(2)}`,
      }).returning();

      if (invoice) {
        const newPaid = round2(Math.max(0, Number(invoice.paid_amount) + refundAmount));
        const invoiceTotal = Number(invoice.total);
        let newStatus: string;
        if (newPaid >= invoiceTotal) newStatus = "PAID";
        else if (newPaid > 0) newStatus = "PARTIAL";
        else newStatus = "SENT";
        await tx.update(invoices).set({ paidAmount: newPaid.toFixed(2), status: newStatus as any }).where(and(eq(invoices.id, payment.invoiceId), eq(invoices.orgId, orgId)));
        const [updatedInvoice] = await tx.select().from(invoices).where(and(eq(invoices.id, payment.invoiceId), eq(invoices.orgId, orgId)));
        return { refund, invoice: updatedInvoice };
      }
      return { refund, invoice: invoice as Invoice };
    });
  }

  async updatePayment(paymentId: string, orgId: string, data: Partial<{ date: string; method: string; notes: string | null; status: string; referenceNumber: string | null }>): Promise<Payment | undefined> {
    const [payment] = await db
      .update(payments)
      .set(data as any)
      .where(and(eq(payments.id, paymentId), eq(payments.orgId, orgId)))
      .returning();
    return payment;
  }

  async deletePayment(paymentId: string, orgId: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [payment] = await tx.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.orgId, orgId)));
      if (!payment) return false;

      await tx.delete(payments).where(and(eq(payments.id, paymentId), eq(payments.orgId, orgId)));

      const lockedRows = await tx.execute(
        sql`SELECT * FROM ${invoices} WHERE id = ${payment.invoiceId} AND org_id = ${orgId} FOR UPDATE`
      );
      const invoice = lockedRows.rows?.[0] as any;

      if (invoice) {
        const newPaid = round2(Math.max(0, Number(invoice.paid_amount) - Number(payment.amount)));
        const invoiceTotal = Number(invoice.total);
        let newStatus: string;
        if (newPaid >= invoiceTotal) newStatus = "PAID";
        else if (newPaid > 0) newStatus = "PARTIAL";
        else newStatus = "SENT";
        await tx.update(invoices).set({ paidAmount: newPaid.toFixed(2), status: newStatus as any }).where(and(eq(invoices.id, payment.invoiceId), eq(invoices.orgId, orgId)));
      }

      return true;
    });
  }

  async createOutboxEmail(data: InsertOutboxEmail) {
    const [email] = await db.insert(outboxEmails).values(data).returning();
    return email;
  }

  /** Delivery history for an invoice — every send attempt, newest first. */
  async getOutboxEmailsByInvoice(invoiceId: string, orgId: string) {
    return db
      .select()
      .from(outboxEmails)
      .where(and(eq(outboxEmails.invoiceId, invoiceId), eq(outboxEmails.orgId, orgId)))
      .orderBy(desc(outboxEmails.createdAt));
  }

  async updateOutboxEmailStatus(
    emailId: string,
    status: string,
    failReason?: string,
    providerMessageId?: string,
  ) {
    const updates: any = { status };
    if (status === "SENT") {
      updates.sentAt = new Date();
    }
    if (failReason) {
      updates.failReason = failReason;
    }
    if (providerMessageId) {
      updates.providerMessageId = providerMessageId;
    }
    await db
      .update(outboxEmails)
      .set(updates)
      .where(eq(outboxEmails.id, emailId));
  }

  async createAuditLog(data: InsertAuditLog, tx?: any) {
    await (tx || db).insert(auditLogs).values(data);
  }

  async getRecentActivity(orgId: string, limit = 30) {
    const rows = await db
      .select({
        log: auditLogs,
        userName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(eq(auditLogs.orgId, orgId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return rows.map(row => ({
      id: row.log.id,
      action: row.log.action,
      entityType: row.log.entityType,
      entityId: row.log.entityId,
      details: row.log.details,
      userName: row.userName || "System",
      createdAt: row.log.createdAt,
    }));
  }

  async getRecentTimesheetActivity(orgId: string, limit = 20) {
    const rows = await db
      .select({
        log: auditLogs,
        userName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.userId, users.id))
      .where(and(
        eq(auditLogs.orgId, orgId),
        eq(auditLogs.entityType, "timesheet"),
        inArray(auditLogs.action, [
          "TIMESHEET_SUBMITTED",
          "TIMESHEET_SUBMITTED_BY_MANAGER",
          "TIMESHEET_RECALLED",
          "TIMESHEET_APPROVED",
          "TIMESHEET_REJECTED",
        ]),
      ))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return rows.map(row => ({
      id: row.log.id,
      action: row.log.action,
      entityType: row.log.entityType,
      entityId: row.log.entityId,
      details: row.log.details,
      actorName: row.userName || "System",
      createdAt: row.log.createdAt,
    }));
  }

  async getDashboardStats(orgId: string) {
    const [unbilledResult] = await db
      .select({
        total: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)`,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.orgId, orgId),
          eq(timeEntries.billable, true),
          eq(timeEntries.invoiced, false),
        ),
      );

    const [clientCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clients)
      .where(eq(clients.orgId, orgId));

    const [projectCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(projects)
      .where(
        and(eq(projects.orgId, orgId), eq(projects.status, "ACTIVE")),
      );

    const [invoiceCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(
        and(
          eq(invoices.orgId, orgId),
          eq(invoices.status, "SENT"),
        ),
      );

    const recentTime = await db
      .select({
        entry: timeEntries,
        userName: users.name,
        projectName: projects.name,
      })
      .from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .where(eq(timeEntries.orgId, orgId))
      .orderBy(desc(timeEntries.createdAt))
      .limit(5);

    const recentInvs = await db
      .select({
        invoice: invoices,
        clientName: clients.name,
      })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(eq(invoices.orgId, orgId), ne(invoices.status, "VOID")))
      .orderBy(desc(invoices.createdAt))
      .limit(20);

    const totalCollected = await this.getCollected(orgId, "2000-01-01", "2099-12-31");
    const totalRevenue = await this.getServiceRevenue(orgId, "2000-01-01", "2099-12-31");
    const totalOutstanding = await this.getOutstandingAR(orgId);

    const [overdueResult] = await db
      .select({
        total: sql<number>`coalesce(sum((cast(${invoices.total} as numeric) - cast(${invoices.paidAmount} as numeric)) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0)`,
      })
      .from(invoices)
      .where(and(
        eq(invoices.orgId, orgId),
        ne(invoices.status, "PAID"),
        ne(invoices.status, "VOID"),
        ne(invoices.status, "DRAFT"),
        sql`${invoices.dueDate}::date < current_date`,
      ));
    const overdueAmount = Number(overdueResult?.total) || 0;

    const unbilledMinutes = Number(unbilledResult?.total) || 0;
    const [unbilledValueResult] = await db
      .select({
        total: sql<number>`coalesce(sum(${timeEntries.minutes} * cast(${timeEntries.rate} as numeric) / 60.0), 0)`,
      })
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.billable, true), eq(timeEntries.invoiced, false)));
    const unbilledValue = round2(Number(unbilledValueResult?.total) || 0);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const sixMonthsAgoStr = sixMonthsAgo.toISOString().split("T")[0];

    const todayStrDash = new Date().toISOString().split("T")[0];
    const revByMonth = await this.getServiceRevenueByMonth(orgId, sixMonthsAgoStr, todayStrDash);
    const payByMonth = await this.getCollectedByMonth(orgId, sixMonthsAgoStr, todayStrDash);

    const allMonths = Array.from(new Set([...revByMonth.map(r => r.month), ...payByMonth.map(r => r.month)]));
    const revenueByMonth = allMonths.sort().map(month => ({
      month,
      invoiced: revByMonth.find(r => r.month === month)?.invoiced || 0,
      collected: payByMonth.find(r => r.month === month)?.collected || 0,
    }));

    const topClientRows = await db
      .select({
        name: clients.name,
        revenue: sql<number>`coalesce(sum(cast(${invoices.subtotal} as numeric) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0)`,
        outstanding: sql<number>`coalesce(sum((cast(${invoices.total} as numeric) - cast(${invoices.paidAmount} as numeric)) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0)`,
      })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(eq(invoices.orgId, orgId), ne(invoices.status, "DRAFT"), ne(invoices.status, "VOID")))
      .groupBy(clients.name)
      .orderBy(sql`sum(cast(${invoices.subtotal} as numeric) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)) desc`)
      .limit(5);
    const topClients = topClientRows.map(r => ({ name: r.name, revenue: round2(Number(r.revenue)), outstanding: round2(Number(r.outstanding)) }));

    const recentPayments = await db
      .select({
        payment: payments,
        invoiceNumber: invoices.number,
        clientName: clients.name,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(eq(payments.orgId, orgId))
      .orderBy(desc(payments.createdAt))
      .limit(20);

    const weekStart = getWeekStartDate(new Date().toISOString().split("T")[0]);
    const weekEnd = new Date(weekStart + "T00:00:00Z");
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const weekEndStr = weekEnd.toISOString().split("T")[0];

    const [weekBillable] = await db
      .select({ total: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)` })
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.billable, true), gte(timeEntries.date, weekStart), lte(timeEntries.date, weekEndStr)));
    const [weekTotal] = await db
      .select({ total: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)` })
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, orgId), gte(timeEntries.date, weekStart), lte(timeEntries.date, weekEndStr)));
    const utilizationThisWeek = (Number(weekTotal?.total) || 0) > 0
      ? round2(Number(weekBillable?.total || 0) / Number(weekTotal?.total) * 100)
      : 0;

    const activeMembers = await this.getActiveTeamMembersList(orgId);
    const memberUtil = await db
      .select({
        userId: timeEntries.userId,
        billableMinutes: sql<number>`coalesce(sum(case when ${timeEntries.billable} then ${timeEntries.minutes} else 0 end), 0)`,
        totalMinutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)`,
      })
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, orgId), gte(timeEntries.date, weekStart), lte(timeEntries.date, weekEndStr)))
      .groupBy(timeEntries.userId);
    const utilMap = new Map(memberUtil.map(c => [c.userId, c]));
    const teamMemberUtilization = activeMembers.map(m => {
      const u = utilMap.get(m.id);
      const billMin = Number(u?.billableMinutes || 0);
      const totMin = Number(u?.totalMinutes || 0);
      return {
        name: m.name,
        billableHours: round2(billMin / 60),
        totalHours: round2(totMin / 60),
        utilization: totMin > 0 ? round2(billMin / totMin * 100) : 0,
      };
    });

    const arRows = await db
      .select({
        total: sql<number>`cast(${invoices.total} as numeric)`,
        paidAmount: sql<number>`cast(${invoices.paidAmount} as numeric)`,
        exchangeRate: sql<number>`coalesce(cast(${invoices.exchangeRate} as numeric), 1)`,
        dueDate: invoices.dueDate,
      })
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), ne(invoices.status, "PAID"), ne(invoices.status, "VOID"), ne(invoices.status, "DRAFT")));
    const now = new Date();
    const arAgingBuckets = { current: 0, days30: 0, days60: 0, days90plus: 0 };
    for (const row of arRows) {
      const outstanding = round2((Number(row.total) - Number(row.paidAmount)) * Number(row.exchangeRate));
      if (outstanding <= 0) continue;
      if (!row.dueDate || new Date(row.dueDate) >= now) {
        arAgingBuckets.current = round2(arAgingBuckets.current + outstanding);
      } else {
        const daysOverdue = Math.floor((now.getTime() - new Date(row.dueDate).getTime()) / (1000 * 60 * 60 * 24));
        if (daysOverdue <= 30) arAgingBuckets.days30 = round2(arAgingBuckets.days30 + outstanding);
        else if (daysOverdue <= 60) arAgingBuckets.days60 = round2(arAgingBuckets.days60 + outstanding);
        else arAgingBuckets.days90plus = round2(arAgingBuckets.days90plus + outstanding);
      }
    }

    const overdueInvoiceRows = await db
      .select({
        id: invoices.id,
        number: invoices.number,
        clientName: clients.name,
        total: invoices.total,
        paidAmount: invoices.paidAmount,
        dueDate: invoices.dueDate,
      })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(
        eq(invoices.orgId, orgId),
        ne(invoices.status, "PAID"),
        ne(invoices.status, "VOID"),
        ne(invoices.status, "DRAFT"),
        sql`${invoices.dueDate}::date < current_date`,
      ))
      .orderBy(asc(invoices.dueDate))
      .limit(20);
    const overdueInvoices = overdueInvoiceRows.map(r => ({
      id: r.id,
      number: r.number,
      clientName: r.clientName || "",
      amount: round2(Number(r.total) - Number(r.paidAmount)),
      daysOverdue: Math.floor((now.getTime() - new Date(r.dueDate!).getTime()) / (1000 * 60 * 60 * 24)),
    }));

    // Note: overdueInvoices.amount stays in native currency (invoice-detail level).
    // USD roll-ups (overdueAmount, arAgingBuckets, totalOutstanding) use exchangeRate above.

    const unbilledByProject = await db
      .select({
        projectName: projects.name,
        clientName: clients.name,
        minutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)`,
        value: sql<number>`coalesce(sum(${timeEntries.minutes} * cast(${timeEntries.rate} as numeric) / 60.0), 0)`,
      })
      .from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.billable, true), eq(timeEntries.invoiced, false)))
      .groupBy(projects.name, clients.name)
      .orderBy(sql`sum(${timeEntries.minutes}) desc`);

    const activeProjectRows = await db
      .select({
        id: projects.id,
        name: projects.name,
        clientName: clients.name,
        memberCount: sql<number>`(select count(*) from ${projectMembers} where ${projectMembers.projectId} = ${projects.id})`,
      })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(and(eq(projects.orgId, orgId), eq(projects.status, "ACTIVE")))
      .orderBy(projects.name);

    return {
      totalRevenue: round2(totalRevenue),
      totalCollected: round2(totalCollected),
      totalOutstanding,
      overdueAmount: round2(overdueAmount),
      unbilledHours: round2(unbilledMinutes / 60),
      unbilledValue,
      totalClients: Number(clientCount?.count) || 0,
      activeProjects: Number(projectCount?.count) || 0,
      pendingInvoices: Number(invoiceCount?.count) || 0,
      revenueByMonth,
      topClients,
      recentTimeEntries: recentTime.map((r) => ({
        id: r.entry.id,
        userName: r.userName,
        projectName: r.projectName,
        minutes: r.entry.minutes,
        date: r.entry.date,
        billable: r.entry.billable,
      })),
      recentInvoices: recentInvs.map((r) => ({
        id: r.invoice.id,
        number: r.invoice.number,
        clientName: r.clientName || "",
        total: r.invoice.total,
        paidAmount: r.invoice.paidAmount,
        status: r.invoice.status,
        issuedDate: r.invoice.issuedDate,
        dueDate: r.invoice.dueDate,
      })),
      recentPayments: recentPayments.map((r) => ({
        invoiceNumber: r.invoiceNumber,
        clientName: r.clientName || "",
        amount: r.payment.amount,
        date: r.payment.date,
        method: r.payment.method,
      })),
      activeTeamCount: activeMembers.length,
      utilizationThisWeek,
      teamMemberUtilization,
      arAgingBuckets,
      overdueInvoices,
      unbilledByProject: unbilledByProject.map(r => ({
        projectName: r.projectName,
        clientName: r.clientName || "",
        minutes: Number(r.minutes),
        value: round2(Number(r.value)),
      })),
      activeProjectsList: activeProjectRows.map(r => ({
        id: r.id,
        name: r.name,
        clientName: r.clientName || "",
        memberCount: Number(r.memberCount),
      })),
    };
  }

  async getTimesheetWeek(
    orgId: string,
    userId: string,
    weekStartDate: string,
  ): Promise<TimesheetWeek | undefined> {
    const [row] = await db
      .select()
      .from(timesheetWeeks)
      .where(
        and(
          eq(timesheetWeeks.orgId, orgId),
          eq(timesheetWeeks.userId, userId),
          eq(timesheetWeeks.weekStartDate, weekStartDate),
        ),
      );
    return row;
  }

  async createTimesheetWeek(data: InsertTimesheetWeek): Promise<TimesheetWeek> {
    const [row] = await db.insert(timesheetWeeks).values(data).returning();
    return row;
  }

  async updateTimesheetWeekStatus(
    id: string,
    orgId: string,
    status: string,
    extra?: { submittedAt?: Date; approvedAt?: Date; approvedByUserId?: string; rejectionReason?: string | null },
  ): Promise<void> {
    const updates: Record<string, unknown> = { status: status as any };
    if (extra?.submittedAt) updates.submittedAt = extra.submittedAt;
    if (extra?.approvedAt) updates.approvedAt = extra.approvedAt;
    if (extra?.approvedByUserId) updates.approvedByUserId = extra.approvedByUserId;
    if (extra?.rejectionReason !== undefined) updates.rejectionReason = extra.rejectionReason;
    await db
      .update(timesheetWeeks)
      .set(updates)
      .where(and(eq(timesheetWeeks.id, id), eq(timesheetWeeks.orgId, orgId)));
  }

  async getSubmittedTimesheets(orgId: string) {
    return db
      .select({
        timesheet: timesheetWeeks,
        userName: users.name,
        userEmail: users.email,
      })
      .from(timesheetWeeks)
      .innerJoin(users, eq(timesheetWeeks.userId, users.id))
      .where(
        and(
          eq(timesheetWeeks.orgId, orgId),
          eq(timesheetWeeks.status, "SUBMITTED"),
        ),
      )
      .orderBy(desc(timesheetWeeks.submittedAt))
      .then((rows) =>
        rows.map((r) => ({
          ...r.timesheet,
          userName: r.userName,
          userEmail: r.userEmail,
        })),
      );
  }

  async getAllTimesheets(orgId: string) {
    const rows = await db
      .select({
        timesheet: timesheetWeeks,
        userName: users.name,
        userEmail: users.email,
        totalMinutes: sql<number>`COALESCE(SUM(CASE WHEN ${timeEntries.date} >= ${timesheetWeeks.weekStartDate} AND ${timeEntries.date} <= (${timesheetWeeks.weekStartDate}::date + 6) AND ${timeEntries.userId} = ${timesheetWeeks.userId} AND ${timeEntries.orgId} = ${timesheetWeeks.orgId} THEN ${timeEntries.minutes} ELSE 0 END), 0)`.as("total_minutes"),
        billableMinutes: sql<number>`COALESCE(SUM(CASE WHEN ${timeEntries.date} >= ${timesheetWeeks.weekStartDate} AND ${timeEntries.date} <= (${timesheetWeeks.weekStartDate}::date + 6) AND ${timeEntries.userId} = ${timesheetWeeks.userId} AND ${timeEntries.orgId} = ${timesheetWeeks.orgId} AND ${timeEntries.billable} = true THEN ${timeEntries.minutes} ELSE 0 END), 0)`.as("billable_minutes"),
      })
      .from(timesheetWeeks)
      .innerJoin(users, eq(timesheetWeeks.userId, users.id))
      .leftJoin(
        timeEntries,
        and(
          eq(timeEntries.orgId, timesheetWeeks.orgId),
          eq(timeEntries.userId, timesheetWeeks.userId),
          gte(timeEntries.date, timesheetWeeks.weekStartDate),
          lte(timeEntries.date, sql`${timesheetWeeks.weekStartDate}::date + 6`),
        ),
      )
      .where(eq(timesheetWeeks.orgId, orgId))
      .groupBy(timesheetWeeks.id, users.name, users.email)
      .orderBy(desc(timesheetWeeks.weekStartDate));

    return rows.map((r) => ({
      ...r.timesheet,
      userName: r.userName,
      userEmail: r.userEmail,
      totalMinutes: Number(r.totalMinutes) || 0,
      billableMinutes: Number(r.billableMinutes) || 0,
    }));
  }

  async getTimeEntriesForWeek(
    orgId: string,
    userId: string,
    weekStartDate: string,
    weekEndDate: string,
  ) {
    return db
      .select({
        entry: timeEntries,
        projectName: projects.name,
        clientName: clients.name,
      })
      .from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(timeEntries.orgId, orgId),
          eq(timeEntries.userId, userId),
          gte(timeEntries.date, weekStartDate),
          lte(timeEntries.date, weekEndDate),
        ),
      )
      .orderBy(asc(timeEntries.date))
      .then((rows) =>
        rows.map((r) => ({
          ...r.entry,
          projectName: r.projectName,
          clientName: r.clientName || "",
        })),
      );
  }

  async getRecentTimesheetsForUser(orgId: string, userId: string, limit: number) {
    const rows = await db
      .select({
        timesheet: timesheetWeeks,
        totalMinutes: sql<number>`COALESCE(SUM(CASE WHEN ${timeEntries.date} >= ${timesheetWeeks.weekStartDate} AND ${timeEntries.date} <= (${timesheetWeeks.weekStartDate}::date + 6) AND ${timeEntries.userId} = ${timesheetWeeks.userId} AND ${timeEntries.orgId} = ${timesheetWeeks.orgId} THEN ${timeEntries.minutes} ELSE 0 END), 0)`.as("total_minutes"),
        billableMinutes: sql<number>`COALESCE(SUM(CASE WHEN ${timeEntries.date} >= ${timesheetWeeks.weekStartDate} AND ${timeEntries.date} <= (${timesheetWeeks.weekStartDate}::date + 6) AND ${timeEntries.userId} = ${timesheetWeeks.userId} AND ${timeEntries.orgId} = ${timesheetWeeks.orgId} AND ${timeEntries.billable} = true THEN ${timeEntries.minutes} ELSE 0 END), 0)`.as("billable_minutes"),
      })
      .from(timesheetWeeks)
      .leftJoin(
        timeEntries,
        and(
          eq(timeEntries.orgId, timesheetWeeks.orgId),
          eq(timeEntries.userId, timesheetWeeks.userId),
          gte(timeEntries.date, timesheetWeeks.weekStartDate),
          lte(timeEntries.date, sql`${timesheetWeeks.weekStartDate}::date + 6`),
        ),
      )
      .where(and(eq(timesheetWeeks.orgId, orgId), eq(timesheetWeeks.userId, userId)))
      .groupBy(timesheetWeeks.id)
      .orderBy(desc(timesheetWeeks.weekStartDate))
      .limit(limit);

    return rows.map((r) => ({
      ...r.timesheet,
      totalMinutes: Number(r.totalMinutes) || 0,
      billableMinutes: Number(r.billableMinutes) || 0,
    }));
  }

  async getTimesheetById(id: string, orgId: string): Promise<TimesheetWeek | undefined> {
    const [row] = await db
      .select()
      .from(timesheetWeeks)
      .where(and(eq(timesheetWeeks.id, id), eq(timesheetWeeks.orgId, orgId)));
    return row;
  }

  async getUnbilledApprovedTimeForClient(orgId: string, clientId: string) {
    return db
      .select({
        entry: timeEntries,
        projectName: projects.name,
        userName: users.name,
        serviceName: services.name,
      })
      .from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .leftJoin(services, eq(timeEntries.serviceId, services.id))
      .where(
        and(
          eq(timeEntries.orgId, orgId),
          eq(projects.clientId, clientId),
          eq(timeEntries.billable, true),
          eq(timeEntries.invoiced, false),
          eq(users.isActive, true),
        ),
      )
      .orderBy(asc(timeEntries.date))
      .then(async (rows) => {
        const approvedSheets = await db
          .select()
          .from(timesheetWeeks)
          .where(and(eq(timesheetWeeks.orgId, orgId), eq(timesheetWeeks.status, "APPROVED")));
        const approvedMap = new Map<string, boolean>();
        for (const ts of approvedSheets) {
          approvedMap.set(`${ts.userId}-${ts.weekStartDate}`, true);
        }
        const { getWeekStartDate } = await import("@shared/schema");
        const result = [];
        for (const row of rows) {
          const weekStart = getWeekStartDate(row.entry.date);
          if (approvedMap.has(`${row.entry.userId}-${weekStart}`)) {
            result.push(row);
          }
        }
        return result;
      });
  }

  async getUtilizationData(orgId: string) {
    const allTimesheets = await db
      .select()
      .from(timesheetWeeks)
      .where(
        and(
          eq(timesheetWeeks.orgId, orgId),
          eq(timesheetWeeks.status, "APPROVED"),
        ),
      );

    const teamMemberMap = new Map<string, {
      name: string;
      weeks: Array<{
        weekStartDate: string;
        billableMinutes: number;
        nonBillableMinutes: number;
        utilization: number;
      }>;
      totalBillable: number;
      totalNonBillable: number;
    }>();

    const allUsers = await db.select().from(users).where(eq(users.orgId, orgId));
    const userMap = new Map<string, typeof allUsers[0]>();
    for (const u of allUsers) userMap.set(u.id, u);

    for (const ts of allTimesheets) {
      const user = userMap.get(ts.userId);
      if (!user) continue;

      const weekEnd = (await import("@shared/schema")).getWeekEndDate(ts.weekStartDate);
      const entries = await db
        .select()
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.orgId, orgId),
            eq(timeEntries.userId, ts.userId),
            gte(timeEntries.date, ts.weekStartDate),
            lte(timeEntries.date, weekEnd),
          ),
        );

      let billable = 0;
      let nonBillable = 0;
      for (const e of entries) {
        if (e.billable) billable += e.minutes;
        else nonBillable += e.minutes;
      }

      if (!teamMemberMap.has(ts.userId)) {
        teamMemberMap.set(ts.userId, {
          name: user.name,
          weeks: [],
          totalBillable: 0,
          totalNonBillable: 0,
        });
      }

      const data = teamMemberMap.get(ts.userId)!;
      data.weeks.push({
        weekStartDate: ts.weekStartDate,
        billableMinutes: billable,
        nonBillableMinutes: nonBillable,
        utilization: computeUtilization(billable, nonBillable),
      });
      data.totalBillable += billable;
      data.totalNonBillable += nonBillable;
    }

    return Array.from(teamMemberMap.entries()).map(([userId, data]) => ({
      userId,
      name: data.name,
      weeks: data.weeks.sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate)),
      totalBillable: data.totalBillable,
      totalNonBillable: data.totalNonBillable,
      overallUtilization: computeUtilization(data.totalBillable, data.totalNonBillable),
    }));
  }

  async updateTimeEntry(entryId: string, orgId: string, data: Partial<InsertTimeEntry>): Promise<TimeEntry | undefined> {
    const existing = await this.getTimeEntryById(entryId, orgId);
    const dateToCheck = data.date || existing?.date;
    if (dateToCheck && await this.isDateInClosedPeriod(orgId, dateToCheck)) {
      throw new Error(`Period is closed — cannot modify ${dateToCheck}`);
    }
    const [entry] = await db.update(timeEntries).set(data).where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, orgId))).returning();
    return entry;
  }

  async deleteTimeEntry(entryId: string, orgId: string): Promise<void> {
    const existing = await this.getTimeEntryById(entryId, orgId);
    if (existing?.date && await this.isDateInClosedPeriod(orgId, existing.date)) {
      throw new Error(`Period is closed — cannot modify ${existing.date}`);
    }
    await db.delete(timeEntries).where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, orgId)));
  }

  async getTimeEntryById(entryId: string, orgId: string): Promise<TimeEntry | undefined> {
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.id, entryId), eq(timeEntries.orgId, orgId)));
    return entry;
  }

  async getReportData(orgId: string) {
    const farPast = "2000-01-01";
    const farFuture = "2099-12-31";
    const revByMonthCanonical = await this.getServiceRevenueByMonth(orgId, farPast, farFuture);
    const colByMonthCanonical = await this.getCollectedByMonth(orgId, farPast, farFuture);
    const allReportMonths = Array.from(new Set([...revByMonthCanonical.map(r => r.month), ...colByMonthCanonical.map(r => r.month)])).sort();
    const revenueByMonth = allReportMonths.map(month => ({
      month,
      invoiced: revByMonthCanonical.find(r => r.month === month)?.invoiced || 0,
      paid: colByMonthCanonical.find(r => r.month === month)?.collected || 0,
    }));

    const unbilledTime = await db
      .select({
        projectName: projects.name,
        clientName: clients.name,
        totalMinutes: sql<number>`sum(${timeEntries.minutes})`,
        totalAmount: sql<number>`sum(cast(${timeEntries.rate} as numeric) * ${timeEntries.minutes} / 60.0)`,
      })
      .from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(timeEntries.orgId, orgId),
          eq(timeEntries.billable, true),
          eq(timeEntries.invoiced, false),
        ),
      )
      .groupBy(projects.name, clients.name);

    const hoursByTeamMember = await db
      .select({
        name: users.name,
        billableMinutes: sql<number>`sum(case when ${timeEntries.billable} then ${timeEntries.minutes} else 0 end)`,
        nonBillableMinutes: sql<number>`sum(case when not ${timeEntries.billable} then ${timeEntries.minutes} else 0 end)`,
      })
      .from(timeEntries)
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(eq(timeEntries.orgId, orgId))
      .groupBy(users.name);

    const bucketResult = await db.execute(sql`
      SELECT
        CASE
          WHEN CURRENT_DATE - due_date::date <= 0 THEN 'Current'
          WHEN CURRENT_DATE - due_date::date <= 30 THEN '1-30 days'
          WHEN CURRENT_DATE - due_date::date <= 60 THEN '31-60 days'
          WHEN CURRENT_DATE - due_date::date <= 90 THEN '61-90 days'
          ELSE '90+ days'
        END as bucket,
        COUNT(*)::int as count,
        COALESCE(SUM((total::numeric - paid_amount::numeric) * COALESCE(exchange_rate::numeric, 1)), 0) as amount
      FROM invoices
      WHERE org_id = ${orgId} AND status NOT IN ('PAID', 'VOID', 'DRAFT')
      GROUP BY bucket
    `);

    const bucketOrder = ["Current", "1-30 days", "31-60 days", "61-90 days", "90+ days"];
    const bucketMap = new Map<string, { bucket: string; amount: number; count: number }>();
    for (const name of bucketOrder) {
      bucketMap.set(name, { bucket: name, amount: 0, count: 0 });
    }
    for (const row of bucketResult.rows as any[]) {
      const entry = bucketMap.get(row.bucket);
      if (entry) {
        entry.amount = round2(Number(row.amount));
        entry.count = Number(row.count);
      }
    }
    const buckets = bucketOrder.map(name => bucketMap.get(name)!);

    return {
      revenueByMonth: revenueByMonth.map((r) => ({
        month: r.month,
        invoiced: Number(r.invoiced),
        paid: Number(r.paid),
      })),
      unbilledTime: unbilledTime.map((r) => ({
        projectName: r.projectName,
        clientName: r.clientName || "",
        totalMinutes: Number(r.totalMinutes),
        totalAmount: Number(r.totalAmount),
      })),
      hoursByTeamMember: hoursByTeamMember.map((r) => ({
        name: r.name,
        billableMinutes: Number(r.billableMinutes),
        nonBillableMinutes: Number(r.nonBillableMinutes),
      })),
      arAging: buckets,
    };
  }

  async getProfitabilityReport(orgId: string, startDate: string, endDate: string) {
    const projectRows = await db
      .select({
        project: projects,
        clientName: clients.name,
      })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .where(eq(projects.orgId, orgId))
      .limit(MAX_REPORT_ROWS);
    if (projectRows.length >= MAX_REPORT_ROWS) console.warn("[reports] Hit MAX_REPORT_ROWS limit in getProfitabilityReport");

    const results = [];
    let totalUnapprovedMinutes = 0;
    let projectsWithUnapproved = 0;

    for (const row of projectRows) {
      const entries = await db
        .select({
          entry: timeEntries,
          memberCostRate: projectMembers.costRateHourly,
        })
        .from(timeEntries)
        .leftJoin(
          projectMembers,
          and(
            eq(projectMembers.projectId, timeEntries.projectId),
            eq(projectMembers.userId, timeEntries.userId),
          ),
        )
        .where(
          and(
            eq(timeEntries.orgId, orgId),
            eq(timeEntries.projectId, row.project.id),
            gte(timeEntries.date, startDate),
            lte(timeEntries.date, endDate),
          ),
        );

      let revenue = 0;
      let cost = 0;
      let unapprovedMinutes = 0;

      for (const e of entries) {
        const ws = getWeekStartDate(e.entry.date);
        const ts = await this.getTimesheetWeek(orgId, e.entry.userId, ws);
        if (ts && ts.status === "APPROVED") {
          const entryRate = e.entry.rate != null ? Number(e.entry.rate) : 0;
          revenue += round2((e.entry.minutes / 60) * entryRate);

          const costRate = e.entry.costRateSnapshot != null
            ? Number(e.entry.costRateSnapshot)
            : Number(e.memberCostRate || 0);
          cost += round2((e.entry.minutes / 60) * costRate);
        } else {
          unapprovedMinutes += e.entry.minutes;
        }
      }
      revenue = round2(revenue);
      cost = round2(cost);

      if (unapprovedMinutes > 0) {
        totalUnapprovedMinutes += unapprovedMinutes;
        projectsWithUnapproved++;
      }

      const expenseData = await this.getProjectExpenseTotal(orgId, row.project.id, startDate, endDate);
      const totalCost = round2(cost + expenseData.total);

      const profitability = computeProfitability(revenue, totalCost);
      results.push({
        projectId: row.project.id,
        projectName: row.project.name,
        clientName: row.clientName || "",
        ...profitability,
        laborCost: cost,
        expenseCost: expenseData.total,
        expenseCount: expenseData.count,
        unapprovedMinutes,
      });
    }

    return {
      rows: results,
      unapprovedHours: round2(totalUnapprovedMinutes / 60),
      projectsWithUnapproved,
    };
  }

  async getWipAgingReport(orgId: string, includeUnapproved: boolean, todayStr: string) {
    const allUnbilled = await db
      .select({
        entry: timeEntries,
        projectName: projects.name,
        clientName: clients.name,
        userName: users.name,
      })
      .from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .innerJoin(users, eq(timeEntries.userId, users.id))
      .where(
        and(
          eq(timeEntries.orgId, orgId),
          eq(timeEntries.billable, true),
          eq(timeEntries.invoiced, false),
        ),
      );

    const filtered = [];
    for (const row of allUnbilled) {
      if (!includeUnapproved) {
        const ws = getWeekStartDate(row.entry.date);
        const ts = await this.getTimesheetWeek(orgId, row.entry.userId, ws);
        if (!ts || ts.status !== "APPROVED") continue;
      }
      filtered.push(row);
    }

    const todayMs = new Date(todayStr + "T00:00:00Z").getTime();

    const byTeamMember: Record<string, Record<string, number>> = {};
    const byClient: Record<string, Record<string, number>> = {};
    const byProject: Record<string, Record<string, number>> = {};

    for (const row of filtered) {
      const entryMs = new Date(row.entry.date + "T00:00:00Z").getTime();
      const ageDays = Math.max(0, Math.floor((todayMs - entryMs) / (1000 * 60 * 60 * 24)));
      const bucket = getAgingBucket(ageDays);
      const amount = round2((row.entry.minutes / 60) * Number(row.entry.rate));

      const emptyBuckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
      if (!byTeamMember[row.userName]) byTeamMember[row.userName] = { ...emptyBuckets };
      byTeamMember[row.userName][bucket] = round2(byTeamMember[row.userName][bucket] + amount);

      if (!byClient[row.clientName]) byClient[row.clientName] = { ...emptyBuckets };
      byClient[row.clientName][bucket] = round2(byClient[row.clientName][bucket] + amount);

      if (!byProject[row.projectName]) byProject[row.projectName] = { ...emptyBuckets };
      byProject[row.projectName][bucket] = round2(byProject[row.projectName][bucket] + amount);
    }

    return { byTeamMember, byClient, byProject, totalEntries: filtered.length, includeUnapproved };
  }

  async get1099TotalsExport(orgId: string, startDate: string, endDate: string) {
    const eligibleUsers = await db
      .select()
      .from(users)
      .where(and(
        eq(users.orgId, orgId),
        eq(users.is1099Eligible, true),
        ne(users.workerType, "W2_EMPLOYEE"),
      ))
      .limit(MAX_REPORT_ROWS);
    if (eligibleUsers.length >= MAX_REPORT_ROWS) console.warn("[reports] Hit MAX_REPORT_ROWS limit in get1099TotalsExport");

    const userIds = eligibleUsers.map(u => u.id);
    const allUserInvoiceLines = userIds.length > 0 ? await db
      .select({
        lineAmount: invoiceLines.amount,
        invoiceId: invoiceLines.invoiceId,
        userId: timeEntries.userId,
        timeEntryMinutes: timeEntries.minutes,
        lineId: invoiceLines.id,
      })
      .from(timeEntries)
      .innerJoin(invoiceLines, eq(timeEntries.invoiceLineId, invoiceLines.id))
      .where(
        and(
          inArray(timeEntries.userId, userIds),
          eq(timeEntries.orgId, orgId),
          gte(timeEntries.date, startDate),
          lte(timeEntries.date, endDate),
        ),
      ) : [];

    const invoiceIdsForLookup = Array.from(new Set(allUserInvoiceLines.map(l => l.invoiceId)));
    const invoiceMap = new Map<string, { status: string; total: string; paidAmount: string }>();
    if (invoiceIdsForLookup.length > 0) {
      const invoiceBatch = await db
        .select({ id: invoices.id, status: invoices.status, total: invoices.total, paidAmount: invoices.paidAmount })
        .from(invoices)
        .where(inArray(invoices.id, invoiceIdsForLookup));
      for (const inv of invoiceBatch) invoiceMap.set(inv.id, inv);
    }

    const uniqueLinesByUser = new Map<string, Map<string, { lineAmount: string; invoiceId: string }>>();
    for (const row of allUserInvoiceLines) {
      if (!uniqueLinesByUser.has(row.userId)) uniqueLinesByUser.set(row.userId, new Map());
      const userMap = uniqueLinesByUser.get(row.userId)!;
      if (!userMap.has(row.lineId)) {
        userMap.set(row.lineId, { lineAmount: row.lineAmount, invoiceId: row.invoiceId });
      }
    }

    const results = [];
    for (const user of eligibleUsers) {
      let totalPaid = 0;
      const userLines = uniqueLinesByUser.get(user.id) || new Map();

      for (const line of userLines.values()) {
        const inv = invoiceMap.get(line.invoiceId);
        if (!inv || inv.status === "DRAFT" || inv.status === "VOID") continue;

        const invoiceTotal = Number(inv.total);
        if (invoiceTotal <= 0) continue;

        const paidRatio = round4(Number(inv.paidAmount) / invoiceTotal);
        totalPaid = round2(totalPaid + round2(Number(line.lineAmount) * paidRatio));
      }

      results.push({
        legalName: user.legalName || user.name,
        email: user.email,
        totalPaidAmount: round2(totalPaid),
      });
    }

    return results;
  }

  async updateUserProfile(userId: string, orgId: string, data: { legalName?: string; mailingAddress?: string; taxIdLast4?: string; is1099Eligible?: boolean }) {
    const updates: Record<string, unknown> = {};
    if (data.legalName !== undefined) updates.legalName = data.legalName;
    if (data.mailingAddress !== undefined) updates.mailingAddress = data.mailingAddress;
    if (data.taxIdLast4 !== undefined) updates.taxIdLast4 = data.taxIdLast4;
    if (data.is1099Eligible !== undefined) updates.is1099Eligible = data.is1099Eligible;
    if (Object.keys(updates).length === 0) return;
    await db.update(users).set(updates).where(and(eq(users.id, userId), eq(users.orgId, orgId)));
  }

  async updateUser(userId: string, orgId: string, data: Partial<{
    name: string; email: string; role: "ADMIN" | "TEAM_MEMBER";
    isActive: boolean; onboardingComplete: boolean; tempPassword: boolean;
    password: string; phone: string; avatarUrl: string;
    legalName: string; payToName: string; ein: string;
    mailingAddress: string;
    addressLine1: string; addressLine2: string; addressCity: string;
    addressState: string; addressZip: string; addressCountry: string;
    taxIdLast4: string; is1099Eligible: boolean;
    paymentMethod: string; bankName: string; bankRoutingNumber: string;
    bankAccountNumber: string; bankAccountType: string; zelleContact: string;
    w9OnFile: boolean; agreementSigned: boolean;
    workerType: string;
    stripeConnectAccountId: string; stripeConnectStatus: string;
    lastLoginAt: Date;
  }>): Promise<User | undefined> {
    const encryptedData = encryptBankingFields(data as Record<string, unknown>);
    const [updated] = await db.update(users).set(encryptedData).where(and(eq(users.id, userId), eq(users.orgId, orgId))).returning();
    return updated ? decryptBankingOnUser(updated as Record<string, unknown>) as User : undefined;
  }

  async deleteUser(userId: string, orgId: string): Promise<boolean> {
    const result = await db.delete(users).where(and(eq(users.id, userId), eq(users.orgId, orgId)));
    return (result as any).rowCount > 0;
  }

  async getTeamMembers(orgId: string) {
    const allUsers = await db.select().from(users).where(eq(users.orgId, orgId)).orderBy(asc(users.name));
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

    const result = [];
    for (const u of allUsers) {
      const memberships = await db
        .select({
          projectId: projectMembers.projectId,
          projectName: projects.name,
          hourlyRate: projectMembers.hourlyRate,
          role: projectMembers.role,
        })
        .from(projectMembers)
        .innerJoin(projects, eq(projects.id, projectMembers.projectId))
        .where(and(eq(projectMembers.userId, u.id), eq(projectMembers.orgId, orgId)));

      const monthEntries = await db
        .select({ minutes: timeEntries.minutes })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, u.id),
            eq(timeEntries.orgId, orgId),
            gte(timeEntries.date, monthStart),
            lte(timeEntries.date, monthEnd),
          ),
        );
      const totalHoursThisMonth = round2(monthEntries.reduce((s, e) => s + e.minutes, 0) / 60);

      const { password: _, ...safeUser } = u;
      const decrypted = tryDecryptBankingOnUser(safeUser as Record<string, unknown>);
      result.push({
        ...decrypted,
        projectCount: memberships.length,
        totalHoursThisMonth,
        projects: memberships,
      });
    }
    return result;
  }

  async getStripeEventByEventId(stripeEventId: string, orgId: string): Promise<StripeEvent | undefined> {
    const [row] = await db
      .select()
      .from(stripeEvents)
      .where(and(eq(stripeEvents.stripeEventId, stripeEventId), eq(stripeEvents.orgId, orgId)));
    return row;
  }

  async createStripeEvent(data: InsertStripeEvent): Promise<StripeEvent> {
    const [row] = await db.insert(stripeEvents).values(data).returning();
    return row;
  }

  async getPaymentByProviderRef(provider: string, providerRef: string, orgId: string): Promise<Payment | undefined> {
    const [row] = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.provider, provider),
          eq(payments.providerRef, providerRef),
          eq(payments.orgId, orgId),
        ),
      );
    return row;
  }

  /**
   * Record a Stripe-originated payment, re-validating the overpayment condition
   * UNDER the invoice row lock (audit #20).
   *
   * The webhook's pre-transaction overpayment guard reads an UNLOCKED
   * `invoice.paidAmount`; two genuinely distinct concurrent checkout sessions
   * (distinct payment_intents → distinct event ids, so the stripe_events unique
   * index does not block them) can both read paidAmount=0, both pass that guard,
   * and both insert — overpaying the invoice. The `SELECT … FOR UPDATE` below
   * serializes the two, so we re-read the locked, committed balance and reject
   * the loser instead of silently writing paidAmount > total.
   *
   * Pass `executor` (the caller's open transaction) to run the lock + insert +
   * recompute on the SAME connection as the caller's other writes — both for true
   * atomicity (the Stripe webhook inserts the `stripe_events` row in the same tx)
   * and to avoid a separate pooled connection blocking on the lock (audit #8/#14).
   * When omitted, this opens its own transaction.
   */
  async createStripePayment(
    data: InsertPayment,
    executor?: DbTransaction,
  ): Promise<CreateStripePaymentResult> {
    if (executor) {
      return this.createStripePaymentInTx(executor, data);
    }
    return await db.transaction((tx) => this.createStripePaymentInTx(tx, data));
  }

  private async createStripePaymentInTx(
    tx: DbTransaction,
    data: InsertPayment,
  ): Promise<CreateStripePaymentResult> {
    if (data.invoiceId) {
      // Lock the invoice row AND read the balance columns we validate against, so
      // the re-check below sees the committed state at lock-acquisition time.
      const lockedRows = await tx.execute(
        sql`SELECT paid_amount, total FROM ${invoices} WHERE id = ${data.invoiceId} AND org_id = ${data.orgId} FOR UPDATE`,
      );
      const lockedInvoice = lockedRows.rows?.[0] as { paid_amount?: unknown; total?: unknown } | undefined;
      if (!lockedInvoice) {
        return { status: "INVOICE_NOT_FOUND" };
      }

      // Overpayment re-check under the lock (audit #20). Mirror the webhook's
      // pre-tx guard semantics exactly (round2(paid + amount) > total) so an exact
      // full payment (newPaid === total) still passes. Negative amounts (refunds
      // never flow through this method) skip the check.
      // Correctness depends on paid_amount == round2(sum(payment rows)): any new
      // payment-insert path must hold this invoice FOR UPDATE and keep paid_amount
      // authoritative (every current writer does — see recomputeInvoicePaidStatus).
      const amount = Number(data.amount);
      if (amount > 0) {
        const lockedPaid = Number(lockedInvoice.paid_amount ?? 0);
        const invoiceTotal = Number(lockedInvoice.total ?? 0);
        if (round2(lockedPaid + amount) > invoiceTotal) {
          return {
            status: "OVERPAYMENT",
            currentPaid: lockedPaid,
            invoiceTotal,
            attempted: amount,
          };
        }
      }
    }

    const [payment] = await tx.insert(payments).values(data).returning();
    if (data.invoiceId && data.orgId) {
      // Recompute on `tx` so the UPDATE runs on the SAME connection that holds the
      // invoice FOR UPDATE lock above, not a separate pooled connection that would
      // block on that lock forever (audit #8/#14).
      await this.recomputeInvoicePaidStatus(data.invoiceId, data.orgId, tx);
    }
    return { status: "OK", payment };
  }

  async getTotalRefundedForInvoice(invoiceId: string, orgId: string): Promise<number> {
    const refundPayments = await db.select({ amount: payments.amount })
      .from(payments)
      .where(and(
        eq(payments.invoiceId, invoiceId),
        eq(payments.orgId, orgId),
        lt(payments.amount, "0"),
      ));
    return round2(refundPayments.reduce((sum, p) => sum + Math.abs(Number(p.amount)), 0));
  }

  async createRefundPaymentAtomic(
    data: InsertPayment,
    invoiceId: string,
    orgId: string,
    refundAmount: number,
  ): Promise<{ success: boolean; payment?: Payment; reason?: string }> {
    return await db.transaction(async (tx) => {
      const [inv] = await tx
        .select({ paidAmount: invoices.paidAmount })
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)))
        .for("update");
      if (!inv) return { success: false, reason: "INVOICE_NOT_FOUND" };

      const refundPayments = await tx.select({ amount: payments.amount })
        .from(payments)
        .where(and(
          eq(payments.invoiceId, invoiceId),
          eq(payments.orgId, orgId),
          lt(payments.amount, "0"),
        ));
      const existingRefundTotal = round2(refundPayments.reduce((sum, p) => sum + Math.abs(Number(p.amount)), 0));
      const totalPaid = Number(inv.paidAmount);

      if (round2(existingRefundTotal + refundAmount) > round2(totalPaid)) {
        return { success: false, reason: "REFUND_EXCEEDS_PAID" };
      }

      const [payment] = await tx.insert(payments).values(data).returning();
      return { success: true, payment };
    });
  }

  async recomputeInvoicePaidStatus(invoiceId: string, orgId: string, executor: DbExecutor = db): Promise<void> {
    // Runs on `executor` so a caller holding the invoice FOR UPDATE can pass its
    // own transaction — otherwise the UPDATE below contends on a separate pooled
    // connection for the very row that caller locked, self-deadlocking with no
    // statement timeout to break it (audit #8/#14).
    const invoicePayments = await executor
      .select()
      .from(payments)
      .where(and(eq(payments.invoiceId, invoiceId), eq(payments.orgId, orgId)));

    const totalPaid = round2(
      invoicePayments.reduce((sum, p) => sum + Number(p.amount), 0),
    );

    const [invoice] = await executor
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)));

    if (!invoice) return;

    const invoiceTotal = Number(invoice.total);
    let newStatus: string;
    if (totalPaid <= 0) {
      newStatus = invoice.status === "VOID" ? "VOID" : "SENT";
    } else if (totalPaid >= invoiceTotal) {
      newStatus = "PAID";
    } else {
      newStatus = "PARTIAL";
    }

    await executor
      .update(invoices)
      .set({
        paidAmount: totalPaid.toFixed(2),
        status: newStatus as any,
      })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)));
  }

  async createImportRun(data: InsertImportRun): Promise<ImportRun> {
    const [run] = await db.insert(importRuns).values(data).returning();
    return run;
  }

  async getImportRunsByOrg(orgId: string): Promise<ImportRun[]> {
    return db
      .select()
      .from(importRuns)
      .where(eq(importRuns.orgId, orgId))
      .orderBy(desc(importRuns.startedAt));
  }

  async getImportRun(id: string): Promise<ImportRun | undefined> {
    const [run] = await db
      .select()
      .from(importRuns)
      .where(eq(importRuns.id, id));
    return run;
  }

  async updateImportRun(
    id: string,
    orgId: string,
    data: Partial<Pick<ImportRun, "status" | "completedAt" | "summaryJson" | "optionsJson" | "planHash">>,
  ): Promise<void> {
    await db.update(importRuns).set(data).where(and(eq(importRuns.id, id), eq(importRuns.orgId, orgId)));
  }

  async createImportFile(data: InsertImportFile): Promise<ImportFile> {
    const [file] = await db.insert(importFiles).values(data).returning();
    return file;
  }

  async getImportFilesByRun(runId: string, orgId: string): Promise<ImportFile[]> {
    return db
      .select({ importFile: importFiles })
      .from(importFiles)
      .innerJoin(importRuns, eq(importFiles.importRunId, importRuns.id))
      .where(and(eq(importFiles.importRunId, runId), eq(importRuns.orgId, orgId)))
      .then(rows => rows.map(r => r.importFile));
  }

  async createImportedKey(data: InsertImportedKey): Promise<ImportedKey> {
    const [key] = await db.insert(importedKeys).values(data).returning();
    return key;
  }

  async getImportedKeyByExternalKey(
    externalKey: string,
    orgId: string,
  ): Promise<ImportedKey | undefined> {
    const [key] = await db
      .select()
      .from(importedKeys)
      .where(and(eq(importedKeys.externalKey, externalKey), eq(importedKeys.orgId, orgId)));
    return key;
  }

  async getImportedKeysByRun(runId: string, orgId: string): Promise<ImportedKey[]> {
    return db
      .select()
      .from(importedKeys)
      .where(and(eq(importedKeys.importRunId, runId), eq(importedKeys.orgId, orgId)));
  }

  async deleteImportedKeysByRun(runId: string): Promise<void> {
    await db
      .delete(importedKeys)
      .where(eq(importedKeys.importRunId, runId));
  }

  async rollbackImportRun(runId: string, orgId: string): Promise<{
    deletedCounts: Record<string, number>;
  }> {
    const [run] = await db.select().from(importRuns).where(and(eq(importRuns.id, runId), eq(importRuns.orgId, orgId)));
    if (!run) throw new Error("Import run not found or does not belong to this organization");

    return db.transaction(async (tx) => {
      const keys = await this.getImportedKeysByRun(runId, orgId);
      const deletedCounts: Record<string, number> = {};

      const grouped: Record<string, ImportedKey[]> = {};
      for (const k of keys) {
        if (!grouped[k.entityType]) grouped[k.entityType] = [];
        grouped[k.entityType].push(k);
      }

      const allEntityIds = keys.map(k => k.entityId);
      if (allEntityIds.length > 0) {
        const glEntries = await tx.select({ id: glJournalEntries.id })
          .from(glJournalEntries)
          .where(and(
            eq(glJournalEntries.orgId, orgId),
            inArray(glJournalEntries.sourceRef, allEntityIds)
          ));
        const glEntryIds = glEntries.map(e => e.id);
        if (glEntryIds.length > 0) {
          await tx.delete(glJournalLines).where(inArray(glJournalLines.journalEntryId, glEntryIds));
          await tx.delete(glJournalEntries).where(inArray(glJournalEntries.id, glEntryIds));
        }
        deletedCounts["gl_journal_entry"] = glEntryIds.length;
      }

      const deleteOrder = [
        "payment",
        "invoice_line",
        "invoice",
        "time_entry",
        "imported_payout",
        "project_member",
        "project",
        "service",
        "team_member",
        "client",
      ];

      for (const entityType of deleteOrder) {
        const items = grouped[entityType];
        if (!items || items.length === 0) continue;
        const ids = items.map((k) => k.entityId);
        let deleted = 0;

        for (const eid of ids) {
          try {
            let result: any;
            if (entityType === "client") {
              result = await tx.delete(clients).where(and(eq(clients.id, eid), eq(clients.orgId, orgId)));
            } else if (entityType === "project") {
              await tx.delete(projectServices).where(and(eq(projectServices.projectId, eid), eq(projectServices.orgId, orgId)));
              result = await tx.delete(projects).where(and(eq(projects.id, eid), eq(projects.orgId, orgId)));
            } else if (entityType === "project_member") {
              result = await tx.delete(projectMembers).where(and(eq(projectMembers.id, eid), eq(projectMembers.orgId, orgId)));
            } else if (entityType === "invoice") {
              await tx.delete(invoiceLines).where(and(eq(invoiceLines.invoiceId, eid), eq(invoiceLines.orgId, orgId)));
              result = await tx.delete(invoices).where(and(eq(invoices.id, eid), eq(invoices.orgId, orgId)));
            } else if (entityType === "invoice_line") {
              result = await tx.delete(invoiceLines).where(and(eq(invoiceLines.id, eid), eq(invoiceLines.orgId, orgId)));
            } else if (entityType === "time_entry") {
              result = await tx.delete(timeEntries).where(and(eq(timeEntries.id, eid), eq(timeEntries.orgId, orgId)));
            } else if (entityType === "imported_payout") {
              result = await tx
                .delete(importedPayouts)
                .where(and(eq(importedPayouts.id, eid), eq(importedPayouts.orgId, orgId)));
            } else if (entityType === "payment") {
              result = await tx.delete(payments).where(and(eq(payments.id, eid), eq(payments.orgId, orgId)));
            } else if (entityType === "service") {
              result = await tx.delete(services).where(and(eq(services.id, eid), eq(services.orgId, orgId)));
            }
            if (result) deleted++;
          } catch {
          }
        }
        deletedCounts[entityType] = deleted;
      }

      await tx.delete(importedKeys).where(eq(importedKeys.importRunId, runId));
      await tx.update(importRuns).set({
        status: "ROLLED_BACK" as any,
        completedAt: new Date(),
      }).where(and(eq(importRuns.id, runId), eq(importRuns.orgId, orgId)));

      return { deletedCounts };
    });
  }

  async getClientByName(orgId: string, name: string): Promise<Client | undefined> {
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.orgId, orgId), eq(clients.name, name)));
    return client;
  }

  async getProjectByName(
    orgId: string,
    clientId: string,
    name: string,
  ): Promise<Project | undefined> {
    const [project] = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.orgId, orgId),
          eq(projects.clientId, clientId),
          eq(projects.name, name),
        ),
      );
    return project;
  }

  async createImportedPayout(
    data: InsertImportedPayout,
  ): Promise<ImportedPayout> {
    const [payout] = await db
      .insert(importedPayouts)
      .values(data)
      .returning();
    return payout;
  }

  async getImportedPayoutByExternalKey(
    externalKey: string,
    orgId: string,
  ): Promise<ImportedPayout | undefined> {
    const [payout] = await db
      .select()
      .from(importedPayouts)
      .where(and(eq(importedPayouts.externalKey, externalKey), eq(importedPayouts.orgId, orgId)));
    return payout;
  }
  async adminListEntity(
    entity: string,
    orgId: string,
    query: string,
    limit: number,
    offset: number,
    allowCrossTenantOrgs: boolean = false,
  ): Promise<{ rows: any[]; total: number }> {
    const tbl = this.getEntityTable(entity);
    if (!tbl) return { rows: [], total: 0 };

    const conditions: any[] = [];
    const hasOrg = "orgId" in tbl;
    if (hasOrg) conditions.push(eq((tbl as any).orgId, orgId));
    // The `orgs` table has no orgId column (its PK *is* the org id), so the
    // generic scoping above skips it — which would expose every tenant's org
    // row (stripe ids, smtp config, apiKey, ...). Scope it to the caller's own
    // org unless they're a platform operator (audit #5).
    else if (entity === "orgs" && !allowCrossTenantOrgs) conditions.push(eq((tbl as any).id, orgId));

    if (entity === "project_members") {
      const members = await db
        .select()
        .from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .where(eq(projects.orgId, orgId))
        .orderBy(desc(projectMembers.id))
        .limit(limit)
        .offset(offset);
      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .where(eq(projects.orgId, orgId));
      return {
        rows: members.map((m) => m.project_members),
        total: countResult[0]?.count ?? 0,
      };
    }

    if (entity === "invoice_lines") {
      const lines = await db
        .select()
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(eq(invoices.orgId, orgId))
        .orderBy(desc(invoiceLines.id))
        .limit(limit)
        .offset(offset);
      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(eq(invoices.orgId, orgId));
      return {
        rows: lines.map((l) => l.invoice_lines),
        total: countResult[0]?.count ?? 0,
      };
    }

    if (query && query.trim()) {
      const searchCol = this.getSearchColumn(entity, tbl);
      if (searchCol) {
        const safeSearch = `%${escapeLikePattern(query.trim())}%`;
        conditions.push(sql`${searchCol} ILIKE ${safeSearch}`);
      }
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const orderCol = "createdAt" in tbl ? (tbl as any).createdAt : (tbl as any).id;

    const rows = await db
      .select()
      .from(tbl)
      .where(where)
      .orderBy(desc(orderCol))
      .limit(limit)
      .offset(offset);

    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tbl)
      .where(where);

    return { rows, total: countResult[0]?.count ?? 0 };
  }

  async adminGetEntity(
    entity: string,
    id: string,
    orgId: string,
    allowCrossTenantOrgs: boolean = false,
  ): Promise<any | undefined> {
    const tbl = this.getEntityTable(entity);
    if (!tbl) return undefined;

    if (entity === "project_members") {
      const [row] = await db
        .select()
        .from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .where(and(eq(projectMembers.id, id), eq(projects.orgId, orgId)));
      return row?.project_members;
    }

    if (entity === "invoice_lines") {
      const [row] = await db
        .select()
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(and(eq(invoiceLines.id, id), eq(invoices.orgId, orgId)));
      return row?.invoice_lines;
    }

    const hasOrg = "orgId" in tbl;
    const conditions = [eq((tbl as any).id, id)];
    if (hasOrg) conditions.push(eq((tbl as any).orgId, orgId));
    // `orgs` has no orgId column; require the requested id to be the caller's
    // own org unless they're a platform operator (audit #5).
    else if (entity === "orgs" && !allowCrossTenantOrgs) conditions.push(eq((tbl as any).id, orgId));

    const [row] = await db.select().from(tbl).where(and(...conditions));
    return row;
  }

  private stripForbiddenFields(data: Record<string, any>): Record<string, any> {
    const copy = { ...data };
    delete copy.id;
    delete copy.orgId;
    delete copy.createdAt;
    delete copy.updatedAt;
    return copy;
  }

  private async validateParentOwnership(
    entity: string,
    data: Record<string, any>,
    orgId: string,
  ): Promise<void> {
    if (entity === "project_members" && data.projectId) {
      const [proj] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, data.projectId), eq(projects.orgId, orgId)));
      if (!proj) throw new Error("Project not found for org");
    }
    if (entity === "invoice_lines" && data.invoiceId) {
      const [inv] = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, data.invoiceId), eq(invoices.orgId, orgId)));
      if (!inv) throw new Error("Invoice not found for org");
    }
  }

  async adminCreateEntity(
    entity: string,
    orgId: string,
    data: Record<string, any>,
  ): Promise<any> {
    const tbl = this.getEntityTable(entity);
    if (!tbl) throw new Error("Unsupported entity");

    const insertData = this.stripForbiddenFields(data);
    if ("orgId" in tbl) {
      insertData.orgId = orgId;
    }

    await this.validateParentOwnership(entity, insertData, orgId);

    const result = await db.insert(tbl).values(insertData).returning();
    return (result as any[])[0];
  }

  async adminUpdateEntity(
    entity: string,
    id: string,
    orgId: string,
    data: Record<string, any>,
  ): Promise<any | undefined> {
    const existing = await this.adminGetEntity(entity, id, orgId);
    if (!existing) return undefined;

    const tbl = this.getEntityTable(entity);
    if (!tbl) return undefined;

    const updateData = this.stripForbiddenFields(data);

    await this.validateParentOwnership(entity, updateData, orgId);

    const result = await db
      .update(tbl)
      .set(updateData)
      .where(eq((tbl as any).id, id))
      .returning();
    return (result as any[])[0];
  }

  async adminDeleteEntity(
    entity: string,
    id: string,
    orgId: string,
  ): Promise<{ deleted: boolean; error?: string }> {
    const existing = await this.adminGetEntity(entity, id, orgId);
    if (!existing) return { deleted: false, error: "not_found" };

    const tbl = this.getEntityTable(entity);
    if (!tbl) return { deleted: false, error: "unsupported" };

    try {
      await db.delete(tbl).where(eq((tbl as any).id, id));
      return { deleted: true };
    } catch (err: any) {
      if (err.code === "23503") {
        return {
          deleted: false,
          error: `Cannot delete: record is referenced by other records (${err.detail || "foreign key constraint"})`,
        };
      }
      throw err;
    }
  }

  private getEntityTable(entity: string): any {
    const map: Record<string, any> = {
      orgs,
      users,
      clients,
      projects,
      project_members: projectMembers,
      project_services: projectServices,
      services,
      time_entries: timeEntries,
      invoices,
      invoice_lines: invoiceLines,
      invoice_revisions: invoiceRevisions,
      payments,
      outbox_emails: outboxEmails,
      timesheet_weeks: timesheetWeeks,
      imported_payouts: importedPayouts,
      team_member_payouts_v2: teamMemberPayoutsV2,
      payout_time_entries: payoutTimeEntries,
      audit_logs: auditLogs,
      import_runs: importRuns,
      import_files: importFiles,
      imported_keys: importedKeys,
      stripe_events: stripeEvents,
      recurring_invoice_templates: recurringInvoiceTemplates,
      estimates,
      estimate_lines: estimateLines,
      expense_categories: expenseCategories,
      expenses,
      expense_reports: expenseReports,
      exchange_rates: exchangeRates,
    };
    return map[entity];
  }

  async getRecurringTemplates(orgId: string) {
    return db
      .select({
        template: recurringInvoiceTemplates,
        clientName: clients.name,
      })
      .from(recurringInvoiceTemplates)
      .innerJoin(clients, eq(recurringInvoiceTemplates.clientId, clients.id))
      .where(eq(recurringInvoiceTemplates.orgId, orgId))
      .orderBy(desc(recurringInvoiceTemplates.createdAt))
      .then((rows) =>
        rows.map((r) => ({ ...r.template, clientName: r.clientName || "" })),
      );
  }

  async getRecurringTemplate(id: string, orgId: string) {
    const [row] = await db
      .select({
        template: recurringInvoiceTemplates,
        clientName: clients.name,
      })
      .from(recurringInvoiceTemplates)
      .innerJoin(clients, eq(recurringInvoiceTemplates.clientId, clients.id))
      .where(and(eq(recurringInvoiceTemplates.id, id), eq(recurringInvoiceTemplates.orgId, orgId)));
    if (!row) return undefined;
    return { ...row.template, clientName: row.clientName || "" };
  }

  async createRecurringTemplate(data: InsertRecurringTemplate): Promise<RecurringInvoiceTemplate> {
    const [tmpl] = await db.insert(recurringInvoiceTemplates).values(data).returning();
    return tmpl;
  }

  async updateRecurringTemplate(id: string, orgId: string, data: Partial<InsertRecurringTemplate>) {
    const [tmpl] = await db
      .update(recurringInvoiceTemplates)
      .set(data)
      .where(and(eq(recurringInvoiceTemplates.id, id), eq(recurringInvoiceTemplates.orgId, orgId)))
      .returning();
    return tmpl;
  }

  async deactivateRecurringTemplate(id: string, orgId: string) {
    const [tmpl] = await db
      .update(recurringInvoiceTemplates)
      .set({ isActive: false })
      .where(and(eq(recurringInvoiceTemplates.id, id), eq(recurringInvoiceTemplates.orgId, orgId)))
      .returning();
    return tmpl;
  }

  advanceNextIssueDate(currentDate: string, frequency: string): string {
    const d = new Date(currentDate + "T00:00:00Z");
    switch (frequency) {
      case "WEEKLY":
        d.setUTCDate(d.getUTCDate() + 7);
        break;
      case "BIWEEKLY":
        d.setUTCDate(d.getUTCDate() + 14);
        break;
      case "MONTHLY":
        d.setUTCMonth(d.getUTCMonth() + 1);
        break;
      case "QUARTERLY":
        d.setUTCMonth(d.getUTCMonth() + 3);
        break;
      default:
        d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return d.toISOString().split("T")[0];
  }

  async getActiveTemplatesDue(orgId: string, asOfDate: string) {
    return db
      .select()
      .from(recurringInvoiceTemplates)
      .where(
        and(
          eq(recurringInvoiceTemplates.orgId, orgId),
          eq(recurringInvoiceTemplates.isActive, true),
          lte(recurringInvoiceTemplates.nextIssueDate, asOfDate),
        ),
      );
  }

  async getEstimates(orgId: string) {
    return db
      .select({
        estimate: estimates,
        clientName: clients.name,
        clientLogoUrl: clients.logoUrl,
      })
      .from(estimates)
      .innerJoin(clients, eq(estimates.clientId, clients.id))
      .where(eq(estimates.orgId, orgId))
      .orderBy(desc(estimates.createdAt))
      .then((rows) =>
        rows.map((r) => ({ ...r.estimate, clientName: r.clientName || "", clientLogoUrl: r.clientLogoUrl || null })),
      );
  }

  async getEstimate(id: string, orgId: string) {
    const [row] = await db
      .select({
        estimate: estimates,
        clientName: clients.name,
        clientLogoUrl: clients.logoUrl,
      })
      .from(estimates)
      .innerJoin(clients, eq(estimates.clientId, clients.id))
      .where(and(eq(estimates.id, id), eq(estimates.orgId, orgId)));
    if (!row) return undefined;
    const lines = await db.select().from(estimateLines).where(eq(estimateLines.estimateId, id));
    return { ...row.estimate, clientName: row.clientName || "", clientLogoUrl: row.clientLogoUrl || null, lines };
  }

  async getEstimateByPublicToken(token: string) {
    const [row] = await db
      .select({
        estimate: estimates,
        clientName: clients.name,
      })
      .from(estimates)
      .innerJoin(clients, eq(estimates.clientId, clients.id))
      .where(eq(estimates.publicToken, token));
    if (!row) return undefined;
    const lines = await db.select().from(estimateLines).where(eq(estimateLines.estimateId, row.estimate.id));
    return { ...row.estimate, clientName: row.clientName || "", lines };
  }

  async createEstimate(data: InsertEstimate): Promise<Estimate> {
    const [est] = await db.insert(estimates).values(data).returning();
    return est;
  }

  async updateEstimate(id: string, orgId: string, data: Record<string, any>) {
    const [est] = await db
      .update(estimates)
      .set(data)
      .where(and(eq(estimates.id, id), eq(estimates.orgId, orgId)))
      .returning();
    return est;
  }

  async getNextEstimateNumber(orgId: string): Promise<string> {
    const org = await this.getOrg(orgId);
    const prefix = org?.estimatePrefix || "EST-";
    return await db.transaction(async (tx) => {
      const rows = await tx.execute(sql`SELECT number FROM estimates WHERE org_id = ${orgId} FOR UPDATE`);
      let maxNum = 0;
      for (const row of rows.rows || rows) {
        const num = String((row as any).number);
        if (num.startsWith(prefix)) {
          const match = num.slice(prefix.length).match(/^(\d+)$/);
          if (match) { const n = parseInt(match[1], 10); if (n > maxNum) maxNum = n; }
        }
      }
      return `${prefix}${String(maxNum + 1).padStart(4, "0")}`;
    });
  }

  async createEstimateLine(data: InsertEstimateLine): Promise<EstimateLine> {
    const [line] = await db.insert(estimateLines).values(data).returning();
    return line;
  }

  async updateEstimateLine(lineId: string, orgId: string, data: { description: string; quantity: string; unitRate: string; amount: string }) {
    const [line] = await db
      .update(estimateLines)
      .set(data)
      .where(and(eq(estimateLines.id, lineId), eq(estimateLines.orgId, orgId)))
      .returning();
    return line;
  }

  async deleteEstimateLine(lineId: string, orgId: string) {
    await db.delete(estimateLines).where(and(eq(estimateLines.id, lineId), eq(estimateLines.orgId, orgId)));
  }

  async deleteEstimate(estimateId: string, orgId: string) {
    await db.delete(estimateLines).where(and(eq(estimateLines.estimateId, estimateId), eq(estimateLines.orgId, orgId)));
    const [deleted] = await db.delete(estimates)
      .where(and(eq(estimates.id, estimateId), eq(estimates.orgId, orgId)))
      .returning();
    return deleted;
  }

  async recalcEstimateTotals(estimateId: string, orgId: string) {
    const lines = await db.select().from(estimateLines).where(and(eq(estimateLines.estimateId, estimateId), eq(estimateLines.orgId, orgId)));
    const [est] = await db.select().from(estimates).where(and(eq(estimates.id, estimateId), eq(estimates.orgId, orgId)));
    if (!est) return;

    const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
    const taxMode = org?.taxCalculationMode || "tax_after_discount";

    const lineAmounts = lines.map((l) => ({ amount: l.amount }));
    const totals = computeInvoiceTotals(
      lineAmounts,
      est.discountType,
      Number(est.discountValue),
      Number(est.taxRate),
      taxMode,
    );

    await db
      .update(estimates)
      .set({
        subtotal: String(totals.subtotal),
        discountAmount: String(totals.discountAmount),
        taxAmount: String(totals.taxAmount),
        total: String(totals.total),
      })
      .where(and(eq(estimates.id, estimateId), eq(estimates.orgId, orgId)));
  }

  async setEstimatePublicToken(id: string, orgId: string, token: string) {
    await db
      .update(estimates)
      .set({ publicToken: token })
      .where(and(eq(estimates.id, id), eq(estimates.orgId, orgId)));
  }

  private getSearchColumn(entity: string, tbl: any): any {
    const map: Record<string, string> = {
      clients: "name",
      projects: "name",
      services: "name",
      invoices: "number",
      payments: "notes",
      imported_payouts: "payeeName",
      audit_logs: "action",
      estimates: "number",
    };
    const col = map[entity];
    if (col && col in tbl) return (tbl as any)[col];
    return null;
  }

  // ─── TEAM MEMBER PAYOUTS V2 ──────────────────────────────────
  async getTeamMemberPayouts(orgId: string, filters?: { teamMemberId?: string; status?: string; dateFrom?: string; dateTo?: string }) {
    const rows = await db
      .select({
        payout: teamMemberPayoutsV2,
        teamMemberName: users.name,
        teamMemberEmail: users.email,
      })
      .from(teamMemberPayoutsV2)
      .leftJoin(users, eq(teamMemberPayoutsV2.teamMemberId, users.id))
      .where(eq(teamMemberPayoutsV2.orgId, orgId))
      .orderBy(desc(teamMemberPayoutsV2.payoutDate));

    let results = rows.map(r => ({
      ...r.payout,
      teamMemberName: r.teamMemberName || "Unknown",
      teamMemberEmail: r.teamMemberEmail || "",
    }));
    if (filters?.teamMemberId) results = results.filter(p => p.teamMemberId === filters.teamMemberId);
    if (filters?.status) results = results.filter(p => p.status === filters.status);
    if (filters?.dateFrom) results = results.filter(p => p.payoutDate >= filters.dateFrom!);
    if (filters?.dateTo) results = results.filter(p => p.payoutDate <= filters.dateTo!);
    return results;
  }

  async getTeamMemberPayoutById(id: string, orgId: string): Promise<TeamMemberPayoutV2 | undefined> {
    const [payout] = await db.select().from(teamMemberPayoutsV2).where(and(eq(teamMemberPayoutsV2.id, id), eq(teamMemberPayoutsV2.orgId, orgId)));
    return payout;
  }

  // Idempotency guard for the invoice-send auto-payout: is there already a
  // non-VOID payout for this (invoice, member)? Matches the new explicit
  // sourceInvoiceId link, and — for payouts created before that column existed —
  // falls back to the exact legacy auto-payout note prefix. The prefix is
  // terminated by " (" right after the number so "Invoice 1 (" never matches
  // "Invoice 10 (" (the substring bug in the old PENDING-only check). VOID
  // payouts are excluded so an admin can re-send to recreate a voided one.
  async hasActiveInvoicePayout(orgId: string, invoiceId: string, invoiceNumber: string, teamMemberId: string): Promise<boolean> {
    const rows = await db
      .select({ sourceInvoiceId: teamMemberPayoutsV2.sourceInvoiceId, notes: teamMemberPayoutsV2.notes })
      .from(teamMemberPayoutsV2)
      .where(and(
        eq(teamMemberPayoutsV2.orgId, orgId),
        eq(teamMemberPayoutsV2.teamMemberId, teamMemberId),
        ne(teamMemberPayoutsV2.status, "VOID"),
      ));
    const legacyPrefix = `Auto-created from Invoice ${invoiceNumber} (`;
    return rows.some(r =>
      r.sourceInvoiceId === invoiceId ||
      (r.sourceInvoiceId == null && (r.notes?.startsWith(legacyPrefix) ?? false))
    );
  }

  async createTeamMemberPayout(data: InsertTeamMemberPayoutV2, executor: DbExecutor = db): Promise<TeamMemberPayoutV2> {
    const [payout] = await executor.insert(teamMemberPayoutsV2).values(data).returning();
    return payout;
  }

  async updateTeamMemberPayout(id: string, orgId: string, data: Partial<{ status: string; notes: string; referenceNumber: string; paymentMethod: string; amount: string; payoutDate: string; stripeTransferId: string; stripeTransferStatus: string }>): Promise<TeamMemberPayoutV2 | undefined> {
    // Reactivating a payout OUT of VOID (→ PENDING/COMPLETED) must re-check the
    // entry-uniqueness invariant under the lock (audit #13). Centralized here so EVERY
    // caller is covered — the PATCH route, the Stripe transfer.created webhook, and any
    // future path — not just one route. Only the VOID→non-VOID transition pays the
    // extra read; all other updates take the fast path below.
    if (data.status !== undefined && data.status !== "VOID") {
      const [current] = await db
        .select({ status: teamMemberPayoutsV2.status, teamMemberId: teamMemberPayoutsV2.teamMemberId })
        .from(teamMemberPayoutsV2)
        .where(and(eq(teamMemberPayoutsV2.id, id), eq(teamMemberPayoutsV2.orgId, orgId)));
      if (current?.status === "VOID") {
        return this.reactivateVoidedPayout(id, orgId, current.teamMemberId, data);
      }
    }
    const [updated] = await db.update(teamMemberPayoutsV2).set(data as any).where(and(eq(teamMemberPayoutsV2.id, id), eq(teamMemberPayoutsV2.orgId, orgId))).returning();
    return updated;
  }

  /**
   * Reactivate a VOID payout (VOID → PENDING/COMPLETED) and apply `updates`, re-checking
   * under the (org, member) lock that none of its linked time entries have meanwhile been
   * paid in ANOTHER non-VOID payout (audit #13). Voiding makes an entry re-payable, so
   * without this check un-voiding could put the same entry in two non-VOID payouts. Throws
   * PayoutEntriesAlreadyPaidError on conflict (caller → 409). The lock + re-check + update
   * run on one connection, mirroring linkTimeEntriesToPayout's guarantee.
   */
  async reactivateVoidedPayout(
    id: string,
    orgId: string,
    teamMemberId: string,
    updates: Record<string, any>,
  ): Promise<TeamMemberPayoutV2 | undefined> {
    return await db.transaction(async (tx) => {
      const lockKey = payoutMemberLockKey(orgId, teamMemberId);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
      const myEntries = await tx
        .select({ timeEntryId: payoutTimeEntries.timeEntryId })
        .from(payoutTimeEntries)
        .where(and(eq(payoutTimeEntries.payoutId, id), eq(payoutTimeEntries.orgId, orgId)));
      const ids = myEntries.map(e => e.timeEntryId);
      if (ids.length > 0) {
        const conflicts = await tx
          .select({ timeEntryId: payoutTimeEntries.timeEntryId })
          .from(payoutTimeEntries)
          .innerJoin(teamMemberPayoutsV2, eq(payoutTimeEntries.payoutId, teamMemberPayoutsV2.id))
          .where(and(
            eq(payoutTimeEntries.orgId, orgId),
            ne(teamMemberPayoutsV2.status, "VOID"),
            ne(payoutTimeEntries.payoutId, id),
            inArray(payoutTimeEntries.timeEntryId, ids),
          ));
        if (conflicts.length > 0) {
          throw new PayoutEntriesAlreadyPaidError(Array.from(new Set(conflicts.map(c => c.timeEntryId))));
        }
      }
      const [updated] = await tx
        .update(teamMemberPayoutsV2)
        .set(updates as any)
        .where(and(eq(teamMemberPayoutsV2.id, id), eq(teamMemberPayoutsV2.orgId, orgId)))
        .returning();
      return updated;
    });
  }

  async deleteTeamMemberPayout(id: string, orgId: string): Promise<boolean> {
    const payout = await this.getTeamMemberPayoutById(id, orgId);
    if (!payout) return false;
    await db.delete(payoutTimeEntries).where(and(eq(payoutTimeEntries.payoutId, id), eq(payoutTimeEntries.orgId, orgId)));
    await db.delete(teamMemberPayoutsV2).where(and(eq(teamMemberPayoutsV2.id, id), eq(teamMemberPayoutsV2.orgId, orgId)));
    return true;
  }

  async getPayoutTimeEntries(payoutId: string, orgId: string): Promise<PayoutTimeEntry[]> {
    return db.select().from(payoutTimeEntries).where(and(eq(payoutTimeEntries.payoutId, payoutId), eq(payoutTimeEntries.orgId, orgId)));
  }

  /**
   * Link time entries to a payout, enforcing that a time entry is paid in at most
   * one non-VOID payout (audit #13). This is the single insert point for the two
   * payout-creation flows (POST /api/payouts and the invoice-send auto-payout), so
   * the guard lives here to cover both. (The generic admin data console can raw-insert
   * into payout_time_entries; that deliberate admin escape hatch is out of scope here.)
   *
   * It serializes all link operations for the (org, member) via an advisory lock and,
   * under that lock, re-queries whether any of the requested entries are already in a
   * non-VOID payout — throwing PayoutEntriesAlreadyPaidError if so (the caller maps it
   * to 409 / skips the member). The lock + re-check + insert run on one connection so
   * two concurrent links for the same member cannot both pass the check and double-pay.
   * VOID payouts are excluded, so an entry can be re-paid after its payout is voided.
   *
   * Pass `executor` = the caller's open transaction so the payout header insert and this
   * link (and its rollback on conflict) are one atomic unit. When omitted, opens its own.
   */
  async linkTimeEntriesToPayout(
    payoutId: string,
    teamMemberId: string,
    entries: { timeEntryId: string; amount: string }[],
    orgId: string,
    executor: DbExecutor = db,
  ): Promise<void> {
    if (entries.length === 0) return;
    const ids = entries.map(e => e.timeEntryId);
    const run = async (tx: Exclude<DbExecutor, typeof db>) => {
      // Serialize same-member link operations so the re-check below is authoritative.
      const lockKey = payoutMemberLockKey(orgId, teamMemberId);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`);
      const conflicts = await tx
        .select({ timeEntryId: payoutTimeEntries.timeEntryId })
        .from(payoutTimeEntries)
        .innerJoin(teamMemberPayoutsV2, eq(payoutTimeEntries.payoutId, teamMemberPayoutsV2.id))
        .where(and(
          eq(payoutTimeEntries.orgId, orgId),
          ne(teamMemberPayoutsV2.status, "VOID"),
          ne(payoutTimeEntries.payoutId, payoutId),
          inArray(payoutTimeEntries.timeEntryId, ids),
        ));
      if (conflicts.length > 0) {
        throw new PayoutEntriesAlreadyPaidError(Array.from(new Set(conflicts.map(c => c.timeEntryId))));
      }
      await tx.insert(payoutTimeEntries).values(entries.map(e => ({ orgId, payoutId, timeEntryId: e.timeEntryId, amount: e.amount })));
    };
    if (executor === db) {
      await db.transaction(run);
    } else {
      await run(executor as Exclude<DbExecutor, typeof db>);
    }
  }

  async getUnpaidTimeEntriesForTeamMember(orgId: string, teamMemberId: string, dateFrom?: string, dateTo?: string) {
    const paidEntryRows = await db
      .select({ timeEntryId: payoutTimeEntries.timeEntryId })
      .from(payoutTimeEntries)
      .innerJoin(teamMemberPayoutsV2, eq(payoutTimeEntries.payoutId, teamMemberPayoutsV2.id))
      .where(and(
        eq(teamMemberPayoutsV2.orgId, orgId),
        ne(teamMemberPayoutsV2.status, "VOID"),
      ));
    const paidIds = new Set(paidEntryRows.map(r => r.timeEntryId));

    const allEntries = await db
      .select({
        id: timeEntries.id,
        date: timeEntries.date,
        minutes: timeEntries.minutes,
        billable: timeEntries.billable,
        notes: timeEntries.notes,
        projectId: timeEntries.projectId,
        invoiced: timeEntries.invoiced,
        costRateSnapshot: timeEntries.costRateSnapshot,
      })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.orgId, orgId),
        eq(timeEntries.userId, teamMemberId),
      ))
      .orderBy(desc(timeEntries.date));

    // Per-entry payout value, so the Record Payment dialog can show — and total —
    // exactly what selecting a subset of entries will be paid. This MUST match
    // the per-entry math in the payout create handler (POST /api/payouts) and the
    // Outstanding Balance in getPayoutSummaryByTeamMember: prefer the rate
    // snapshot captured when the hours were logged, fall back to the current
    // project cost rate, and round EACH line to the cent. The client sums these
    // already-rounded line values, so the dialog amount foots to the cent with
    // the amount the server actually records for the same selection.
    const memberships = await db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.orgId, orgId), eq(projectMembers.userId, teamMemberId)));
    const costRateByProject: Record<string, number> = {};
    for (const m of memberships) {
      costRateByProject[m.projectId] = Number(m.costRateHourly) || 0;
    }

    let unpaid = allEntries.filter(e => !paidIds.has(e.id));
    if (dateFrom) unpaid = unpaid.filter(e => e.date >= dateFrom);
    if (dateTo) unpaid = unpaid.filter(e => e.date <= dateTo);
    return unpaid.map(({ costRateSnapshot, ...e }) => {
      const snapshotMissing = costRateSnapshot == null || String(costRateSnapshot) === "";
      const rate = !snapshotMissing ? Number(costRateSnapshot) : (costRateByProject[e.projectId] || 0);
      return { ...e, value: round2((e.minutes / 60) * rate) };
    });
  }

  async getPayoutSummaryByTeamMember(orgId: string) {
    const memberUsers = await db.select().from(users).where(and(eq(users.orgId, orgId), eq(users.role, "TEAM_MEMBER"), eq(users.isActive, true), ne(users.workerType, "W2_EMPLOYEE")));
    const usersWithPayouts = await db
      .select({ memberId: teamMemberPayoutsV2.teamMemberId })
      .from(teamMemberPayoutsV2)
      .where(eq(teamMemberPayoutsV2.orgId, orgId))
      .groupBy(teamMemberPayoutsV2.teamMemberId);
    const memberIds = new Set(memberUsers.map(c => c.id));
    const missingIds = usersWithPayouts.filter(r => !memberIds.has(r.memberId)).map(r => r.memberId);
    if (missingIds.length > 0) {
      const extraUsers = await db.select().from(users).where(and(eq(users.orgId, orgId), inArray(users.id, missingIds)));
      for (const u of extraUsers) {
        memberUsers.push(u);
        memberIds.add(u.id);
      }
    }
    const members = memberUsers;
    if (members.length === 0) return [];

    const allMemberIds = members.map(c => c.id);

    const allEntries = await db
      .select({
        id: timeEntries.id,
        minutes: timeEntries.minutes,
        billable: timeEntries.billable,
        projectId: timeEntries.projectId,
        userId: timeEntries.userId,
        costRateSnapshot: timeEntries.costRateSnapshot,
      })
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, orgId), inArray(timeEntries.userId, allMemberIds)));

    const entriesByUser = new Map<string, typeof allEntries>();
    for (const e of allEntries) {
      if (!entriesByUser.has(e.userId)) entriesByUser.set(e.userId, []);
      entriesByUser.get(e.userId)!.push(e);
    }

    const projectIdsInEntries = Array.from(new Set(allEntries.map(e => e.projectId).filter(Boolean)));
    const projectRows = projectIdsInEntries.length > 0
      ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.orgId, orgId), inArray(projects.id, projectIdsInEntries)))
      : [];
    const projectNameById = new Map<string, string>(projectRows.map(p => [p.id, p.name]));

    const allPaidEntryRows = await db
      .select({ timeEntryId: payoutTimeEntries.timeEntryId, memberId: teamMemberPayoutsV2.teamMemberId })
      .from(payoutTimeEntries)
      .innerJoin(teamMemberPayoutsV2, eq(payoutTimeEntries.payoutId, teamMemberPayoutsV2.id))
      .where(and(
        eq(teamMemberPayoutsV2.orgId, orgId),
        inArray(teamMemberPayoutsV2.teamMemberId, allMemberIds),
        ne(teamMemberPayoutsV2.status, "VOID"),
      ));
    const paidIdsByUser = new Map<string, Set<string>>();
    for (const r of allPaidEntryRows) {
      if (!paidIdsByUser.has(r.memberId)) paidIdsByUser.set(r.memberId, new Set());
      paidIdsByUser.get(r.memberId)!.add(r.timeEntryId);
    }

    const allMemberships = await db.select().from(projectMembers).where(and(eq(projectMembers.orgId, orgId), inArray(projectMembers.userId, allMemberIds)));
    const membershipsByUser = new Map<string, typeof allMemberships>();
    for (const m of allMemberships) {
      if (!membershipsByUser.has(m.userId)) membershipsByUser.set(m.userId, []);
      membershipsByUser.get(m.userId)!.push(m);
    }

    const payoutAggRows = await db
      .select({
        memberId: teamMemberPayoutsV2.teamMemberId,
        status: teamMemberPayoutsV2.status,
        totalAmount: sql<string>`coalesce(sum(${teamMemberPayoutsV2.amount}), 0)`,
        lastDate: sql<string>`max(${teamMemberPayoutsV2.payoutDate})`,
      })
      .from(teamMemberPayoutsV2)
      .where(and(eq(teamMemberPayoutsV2.orgId, orgId), inArray(teamMemberPayoutsV2.teamMemberId, allMemberIds)))
      .groupBy(teamMemberPayoutsV2.teamMemberId, teamMemberPayoutsV2.status);

    const payoutAggByUser = new Map<string, { completedTotal: number; pendingTotal: number; lastDate: string | null }>();
    for (const r of payoutAggRows) {
      if (!payoutAggByUser.has(r.memberId)) payoutAggByUser.set(r.memberId, { completedTotal: 0, pendingTotal: 0, lastDate: null });
      const agg = payoutAggByUser.get(r.memberId)!;
      if (r.status === "COMPLETED") {
        agg.completedTotal = Number(r.totalAmount);
        agg.lastDate = r.lastDate;
      } else if (r.status === "PENDING") {
        agg.pendingTotal = Number(r.totalAmount);
      }
    }

    const results = [];
    for (const member of members) {
      const entries = entriesByUser.get(member.id) || [];
      const paidIds = paidIdsByUser.get(member.id) || new Set();
      const memberships = membershipsByUser.get(member.id) || [];

      const costRateByProject: Record<string, number> = {};
      const costRateDefinedForProject: Record<string, boolean> = {};
      for (const m of memberships) {
        costRateByProject[m.projectId] = Number(m.costRateHourly) || 0;
        costRateDefinedForProject[m.projectId] = m.costRateHourly != null && String(m.costRateHourly) !== "";
      }

      const totalMinutes = entries.reduce((s, e) => s + e.minutes, 0);
      const paidMinutes = entries.filter(e => paidIds.has(e.id)).reduce((s, e) => s + e.minutes, 0);
      const unpaidMinutes = totalMinutes - paidMinutes;

      const unpaidEntries = entries.filter(e => !paidIds.has(e.id));
      let amountOwed = 0;
      const missingProjectIds = new Set<string>();
      for (const e of unpaidEntries) {
        // Use the rate snapshot captured when the hours were logged, falling
        // back to the current project rate. This MUST match the per-entry math
        // in the payout create handler and /api/my/earnings so the Outstanding
        // Balance foots to the sum of the line items the admin and consultant
        // see — round each line, then sum (not sum-then-round).
        const snapshotMissing = e.costRateSnapshot == null || String(e.costRateSnapshot) === "";
        const rate = !snapshotMissing
          ? Number(e.costRateSnapshot)
          : (costRateByProject[e.projectId] || 0);
        amountOwed += round2((e.minutes / 60) * rate);
        if (snapshotMissing && !costRateDefinedForProject[e.projectId]) {
          missingProjectIds.add(e.projectId);
        }
      }
      // After the legacy backfill (see migrate-production.ts Bundle 48),
      // entries that still have no derivable rate need a fresh admin decision —
      // there's no prior snapshot or other-project rate to fall back on for
      // this user. Surface that explicitly so the UI can distinguish "set a
      // rate on the project" from "this team member has no rate anywhere".
      const userHasAnyRateAnywhere =
        memberships.some(m => m.costRateHourly != null && String(m.costRateHourly) !== "" && Number(m.costRateHourly) > 0)
        || entries.some(e => e.costRateSnapshot != null && String(e.costRateSnapshot) !== "" && Number(e.costRateSnapshot) > 0);
      const noDerivableCostRate = missingProjectIds.size > 0 && !userHasAnyRateAnywhere;
      const costRateMissingProjects = Array.from(missingProjectIds).map(pid => ({
        projectId: pid,
        projectName: projectNameById.get(pid) || "Unknown project",
      }));

      const agg = payoutAggByUser.get(member.id) || { completedTotal: 0, pendingTotal: 0, lastDate: null };

      results.push({
        teamMemberId: member.id,
        teamMemberName: member.name,
        teamMemberEmail: member.email,
        paymentMethod: member.paymentMethod,
        totalMinutes,
        paidMinutes,
        unpaidMinutes,
        totalHours: round2(totalMinutes / 60),
        paidHours: round2(paidMinutes / 60),
        unpaidHours: round2(unpaidMinutes / 60),
        unpaidTimeValue: round2(amountOwed),
        pendingPayoutAmount: round2(agg.pendingTotal),
        amountOwed: round2(amountOwed + agg.pendingTotal),
        totalPaidOut: agg.completedTotal,
        lastPayoutDate: agg.lastDate || null,
        costRateMissing: costRateMissingProjects.length > 0,
        costRateMissingProjects,
        noDerivableCostRate,
      });
    }

    return results;
  }

  async integrityCheck(orgId: string) {
    const violations: { type: string; entity: string; id: string; detail: string }[] = [];

    const allInvoices = await db.select().from(invoices).where(eq(invoices.orgId, orgId));
    for (const inv of allInvoices) {
      const total = Number(inv.total || 0);
      const paid = Number(inv.paidAmount || 0);
      if (paid > total && total > 0) {
        violations.push({ type: "OVERPAID_INVOICE", entity: "invoice", id: inv.id, detail: `paidAmount ${paid} > total ${total}` });
      }
      if (inv.status === "PAID" && paid < total) {
        violations.push({ type: "STATUS_MISMATCH", entity: "invoice", id: inv.id, detail: `status PAID but paidAmount ${paid} < total ${total}` });
      }
      if (inv.status === "SENT" && paid > 0) {
        violations.push({ type: "STATUS_MISMATCH", entity: "invoice", id: inv.id, detail: `status SENT but paidAmount ${paid} > 0, should be PARTIAL` });
      }
    }

    const invoiceIds = new Set(allInvoices.map(i => i.id));

    const allPaymentRows = await db
      .select({ id: payments.id, invoiceId: payments.invoiceId, amount: payments.amount })
      .from(payments)
      .where(eq(payments.orgId, orgId));

    const orphanCandidateIds = allPaymentRows.filter(p => !invoiceIds.has(p.invoiceId)).map(p => p.invoiceId);
    const existingOrphanInvoices = new Set<string>();
    if (orphanCandidateIds.length > 0) {
      const found = await db.select({ id: invoices.id }).from(invoices).where(inArray(invoices.id, orphanCandidateIds));
      for (const f of found) existingOrphanInvoices.add(f.id);
    }
    for (const p of allPaymentRows) {
      if (!invoiceIds.has(p.invoiceId) && !existingOrphanInvoices.has(p.invoiceId)) {
        violations.push({ type: "ORPHANED_PAYMENT", entity: "payment", id: p.id, detail: `references invoice ${p.invoiceId} which doesn't exist` });
      }
    }

    const orgPaymentRows = allPaymentRows.filter(p => invoiceIds.has(p.invoiceId));

    const clientIds = Array.from(new Set(allInvoices.map(i => i.clientId)));
    for (const cid of clientIds) {
      const clientInvs = allInvoices.filter(i => i.clientId === cid && !["DRAFT", "VOID"].includes(i.status));
      const clientBilled = clientInvs.reduce((s, i) => s + Number(i.total || 0) * Number((i as any).exchangeRate || 1), 0);
      const clientInvIds = new Set(allInvoices.filter(i => i.clientId === cid).map(i => i.id));
      const clientPaid = orgPaymentRows
        .filter(p => clientInvIds.has(p.invoiceId))
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      if (clientPaid > clientBilled && clientBilled > 0) {
        violations.push({ type: "CLIENT_OVERPAID", entity: "client", id: cid, detail: `totalPaid ${round2(clientPaid)} > totalBilled ${round2(clientBilled)}` });
      }
    }

    return violations;
  }

  // ══════════════════════════════════════════════════════════════════
  // REPORT & DASHBOARD METHODS
  // ══════════════════════════════════════════════════════════════════

  async getClientRevenueReport(orgId: string) {
    const rows = await db
      .select({
        clientId: clients.id,
        clientName: clients.name,
        clientEmail: clients.email,
        invoiceCount: sql<number>`count(${invoices.id})::int`,
        totalInvoiced: sql<number>`coalesce(sum(cast(${invoices.subtotal} as numeric) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0)`,
        totalPaid: sql<number>`coalesce(sum(cast(${invoices.paidAmount} as numeric) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0)`,
        totalOutstanding: sql<number>`coalesce(sum((cast(${invoices.total} as numeric) - cast(${invoices.paidAmount} as numeric)) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0)`,
      })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(eq(invoices.orgId, orgId), ne(invoices.status, "VOID"), ne(invoices.status, "DRAFT")))
      .groupBy(clients.id, clients.name, clients.email)
      .orderBy(sql`coalesce(sum(cast(${invoices.subtotal} as numeric) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0) desc`);

    const grandTotal = rows.reduce((s, r) => s + Number(r.totalInvoiced), 0);
    return rows.map(r => ({
      ...r,
      totalInvoiced: round2(Number(r.totalInvoiced)),
      totalPaid: round2(Number(r.totalPaid)),
      totalOutstanding: round2(Number(r.totalOutstanding)),
      revenuePercent: grandTotal > 0 ? round2((Number(r.totalInvoiced) / grandTotal) * 100) : 0,
    }));
  }

  async getCashFlowReport(orgId: string) {
    const inflows = await this.getCollectedByMonth(orgId, "2000-01-01", "2099-12-31");

    // Money OUT: payouts to team members by month
    const outflows = await db
      .select({
        month: sql<string>`to_char(cast(${teamMemberPayoutsV2.payoutDate} as date), 'YYYY-MM')`,
        totalOut: sql<number>`coalesce(sum(cast(${teamMemberPayoutsV2.amount} as numeric)), 0)`,
      })
      .from(teamMemberPayoutsV2)
      .where(and(eq(teamMemberPayoutsV2.orgId, orgId), eq(teamMemberPayoutsV2.status, "COMPLETED")))
      .groupBy(sql`to_char(cast(${teamMemberPayoutsV2.payoutDate} as date), 'YYYY-MM')`)
      .orderBy(sql`to_char(cast(${teamMemberPayoutsV2.payoutDate} as date), 'YYYY-MM')`);

    // Merge into unified timeline
    const months = new Set<string>();
    inflows.forEach(r => months.add(r.month));
    outflows.forEach(r => months.add(r.month));
    const sorted = Array.from(months).sort();

    const inflowMap: Record<string, number> = {};
    const outflowMap: Record<string, number> = {};
    inflows.forEach(r => { inflowMap[r.month] = r.collected; });
    outflows.forEach(r => { outflowMap[r.month] = round2(Number(r.totalOut)); });

    let runningNet = 0;
    return sorted.map(month => {
      const inAmt = inflowMap[month] || 0;
      const outAmt = outflowMap[month] || 0;
      runningNet = round2(runningNet + inAmt - outAmt);
      return { month, cashIn: inAmt, cashOut: outAmt, net: round2(inAmt - outAmt), runningNet };
    });
  }

  async getCollectionsEfficiencyReport(orgId: string) {
    const paidInvoices = await db
      .select({
        id: invoices.id,
        number: invoices.number,
        clientId: invoices.clientId,
        total: invoices.total,
        createdAt: invoices.createdAt,
        issuedDate: invoices.issuedDate,
        dueDate: invoices.dueDate,
      })
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), eq(invoices.status, "PAID")));

    const results = [];
    for (const inv of paidInvoices) {
      const firstPayment = await db
        .select({ date: payments.date })
        .from(payments)
        .where(eq(payments.invoiceId, inv.id))
        .orderBy(asc(payments.date))
        .limit(1);

      const sentDate = inv.createdAt || (inv.issuedDate ? new Date(inv.issuedDate + "T12:00:00") : null);
      if (firstPayment.length > 0 && sentDate) {
        const sentDateObj = new Date(sentDate);
        const payDate = new Date(firstPayment[0].date + "T12:00:00");
        const daysToCollect = Math.max(0, Math.floor((payDate.getTime() - sentDateObj.getTime()) / (1000 * 60 * 60 * 24)));
        results.push({
          invoiceId: inv.id,
          invoiceNumber: inv.number,
          clientId: inv.clientId,
          total: Number(inv.total),
          daysToCollect,
          sentDate: sentDateObj.toISOString().split("T")[0],
          paidDate: firstPayment[0].date,
        });
      }
    }

    // Also compute per-client averages
    const byClient: Record<string, { days: number[]; clientId: string }> = {};
    for (const r of results) {
      if (!byClient[r.clientId]) byClient[r.clientId] = { days: [], clientId: r.clientId };
      byClient[r.clientId].days.push(r.daysToCollect);
    }

    const clientAverages = [];
    for (const [clientId, data] of Object.entries(byClient)) {
      const avg = data.days.reduce((s, d) => s + d, 0) / data.days.length;
      const client = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId)).limit(1);
      clientAverages.push({
        clientId,
        clientName: client[0]?.name || "Unknown",
        avgDaysToCollect: round2(avg),
        invoiceCount: data.days.length,
      });
    }

    const overallAvg = results.length > 0
      ? round2(results.reduce((s, r) => s + r.daysToCollect, 0) / results.length)
      : 0;

    return { overallAvgDays: overallAvg, invoiceCount: results.length, byClient: clientAverages.sort((a, b) => b.avgDaysToCollect - a.avgDaysToCollect), invoices: results };
  }

  async getBudgetBurnReport(orgId: string) {
    const allProjects = await db
      .select()
      .from(projects)
      .where(and(eq(projects.orgId, orgId), ne(projects.status, "ARCHIVED")));

    const results = [];
    for (const proj of allProjects) {
      const hoursResult = await db
        .select({
          totalMinutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)`,
          billableMinutes: sql<number>`coalesce(sum(case when ${timeEntries.billable} then ${timeEntries.minutes} else 0 end), 0)`,
        })
        .from(timeEntries)
        .where(and(eq(timeEntries.projectId, proj.id), eq(timeEntries.orgId, orgId)));

      const totalHours = round2(Number(hoursResult[0]?.totalMinutes || 0) / 60);
      const billableHours = round2(Number(hoursResult[0]?.billableMinutes || 0) / 60);
      const budgetHours = Number(proj.budgetHours) || 0;
      const burnPercent = budgetHours > 0 ? round2((totalHours / budgetHours) * 100) : 0;
      const remainingHours = budgetHours > 0 ? round2(budgetHours - totalHours) : 0;

      const client = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, proj.clientId)).limit(1);

      results.push({
        projectId: proj.id,
        projectName: proj.name,
        clientName: client[0]?.name || "Unknown",
        status: proj.status,
        budgetHours,
        totalHours,
        billableHours,
        burnPercent,
        remainingHours,
        startDate: proj.startDate,
        endDate: proj.endDate,
        overBudget: budgetHours > 0 && totalHours > budgetHours,
      });
    }
    return results.sort((a, b) => b.burnPercent - a.burnPercent);
  }

  async getOverdueInvoiceDetail(orgId: string) {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    const overdue = await db
      .select({
        id: invoices.id,
        number: invoices.number,
        clientId: invoices.clientId,
        clientName: clients.name,
        clientEmail: clients.email,
        total: invoices.total,
        paidAmount: invoices.paidAmount,
        issuedDate: invoices.issuedDate,
        dueDate: invoices.dueDate,
        status: invoices.status,
        createdAt: invoices.createdAt,
      })
      .from(invoices)
      .innerJoin(clients, eq(invoices.clientId, clients.id))
      .where(and(
        eq(invoices.orgId, orgId),
        ne(invoices.status, "PAID"),
        ne(invoices.status, "VOID"),
        ne(invoices.status, "DRAFT"),
        sql`${invoices.dueDate} < ${todayStr}`,
      ))
      .orderBy(asc(invoices.dueDate));

    return overdue.map(inv => {
      const dueDate = new Date(inv.dueDate + "T12:00:00");
      const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      const outstanding = round2(Number(inv.total) - Number(inv.paidAmount));
      return { ...inv, total: Number(inv.total), paidAmount: Number(inv.paidAmount), outstanding, daysOverdue, sentAt: inv.createdAt };
    });
  }

  async getTimesheetComplianceReport(orgId: string, weeksBack: number = 8) {
    const teamMembers = await db
      .select({ id: users.id, name: users.name, workerType: users.workerType })
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.role, "TEAM_MEMBER"), eq(users.isActive, true)));

    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const currentMonday = new Date(now);
    currentMonday.setDate(now.getDate() + mondayOffset);

    const weeks: string[] = [];
    for (let i = 0; i < weeksBack; i++) {
      const d = new Date(currentMonday);
      d.setDate(d.getDate() - (i * 7));
      weeks.push(d.toISOString().split("T")[0]);
    }
    weeks.reverse();

    const allTimesheets = await db
      .select()
      .from(timesheetWeeks)
      .where(eq(timesheetWeeks.orgId, orgId));

    const tsMap: Record<string, Record<string, string>> = {};
    for (const ts of allTimesheets) {
      if (!tsMap[ts.userId]) tsMap[ts.userId] = {};
      tsMap[ts.userId][ts.weekStartDate] = ts.status;
    }

    const compliance = teamMembers.map(c => {
      const weekData = weeks.map(w => ({
        weekStart: w,
        status: tsMap[c.id]?.[w] || "NOT_SUBMITTED",
      }));
      const submitted = weekData.filter(w => w.status !== "NOT_SUBMITTED" && w.status !== "DRAFT").length;
      return {
        teamMemberId: c.id,
        teamMemberName: c.name,
        workerType: c.workerType,
        weeks: weekData,
        submittedCount: submitted,
        totalWeeks: weeks.length,
        complianceRate: weeks.length > 0 ? round2((submitted / weeks.length) * 100) : 0,
      };
    });

    return { weeks, teamMembers: compliance.sort((a, b) => a.complianceRate - b.complianceRate) };
  }

  async getLaborSummaryByWorkerType(orgId: string) {
    const allUsers = await db
      .select({ id: users.id, name: users.name, workerType: users.workerType, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.orgId, orgId), eq(users.role, "TEAM_MEMBER")));

    const memberships = await db.select().from(projectMembers).where(eq(projectMembers.orgId, orgId));
    const costRateByUserProject: Record<string, Record<string, number>> = {};
    for (const m of memberships) {
      if (!costRateByUserProject[m.userId]) costRateByUserProject[m.userId] = {};
      costRateByUserProject[m.userId][m.projectId] = Number(m.costRateHourly) || 0;
    }

    const entries = await db.select().from(timeEntries).where(eq(timeEntries.orgId, orgId));

    const byType: Record<string, { headcount: number; activeCount: number; totalMinutes: number; billableMinutes: number; totalCost: number }> = {};

    for (const u of allUsers) {
      const wt = u.workerType || "INDEPENDENT";
      if (!byType[wt]) byType[wt] = { headcount: 0, activeCount: 0, totalMinutes: 0, billableMinutes: 0, totalCost: 0 };
      byType[wt].headcount++;
      if (u.isActive) byType[wt].activeCount++;

      const userEntries = entries.filter(e => e.userId === u.id);
      for (const e of userEntries) {
        byType[wt].totalMinutes += e.minutes;
        if (e.billable) byType[wt].billableMinutes += e.minutes;
        const rate = costRateByUserProject[u.id]?.[e.projectId] || 0;
        byType[wt].totalCost += (e.minutes / 60) * rate;
      }
    }

    return Object.entries(byType).map(([workerType, data]) => ({
      workerType,
      headcount: data.headcount,
      activeCount: data.activeCount,
      totalHours: round2(data.totalMinutes / 60),
      billableHours: round2(data.billableMinutes / 60),
      totalCost: round2(data.totalCost),
      utilization: data.totalMinutes > 0 ? round2((data.billableMinutes / data.totalMinutes) * 100) : 0,
    }));
  }

  async getPayoutDetailReport(orgId: string, startDate?: string, endDate?: string) {
    const conditions = [eq(teamMemberPayoutsV2.orgId, orgId)];
    if (startDate) conditions.push(gte(teamMemberPayoutsV2.payoutDate, startDate));
    if (endDate) conditions.push(lte(teamMemberPayoutsV2.payoutDate, endDate));

    const allPayouts = await db
      .select({
        id: teamMemberPayoutsV2.id,
        teamMemberId: teamMemberPayoutsV2.teamMemberId,
        teamMemberName: users.name,
        teamMemberEmail: users.email,
        workerType: users.workerType,
        amount: teamMemberPayoutsV2.amount,
        payoutDate: teamMemberPayoutsV2.payoutDate,
        paymentMethod: teamMemberPayoutsV2.paymentMethod,
        referenceNumber: teamMemberPayoutsV2.referenceNumber,
        status: teamMemberPayoutsV2.status,
        notes: teamMemberPayoutsV2.notes,
        periodStart: teamMemberPayoutsV2.periodStart,
        periodEnd: teamMemberPayoutsV2.periodEnd,
      })
      .from(teamMemberPayoutsV2)
      .innerJoin(users, eq(teamMemberPayoutsV2.teamMemberId, users.id))
      .where(and(...conditions))
      .orderBy(desc(teamMemberPayoutsV2.payoutDate));

    // Group by team member for summary
    const byTeamMember: Record<string, { name: string; email: string; workerType: string; totalPaid: number; count: number }> = {};
    for (const p of allPayouts) {
      if (p.status !== "COMPLETED") continue;
      if (!byTeamMember[p.teamMemberId]) {
        byTeamMember[p.teamMemberId] = { name: p.teamMemberName, email: p.teamMemberEmail, workerType: p.workerType || "INDEPENDENT", totalPaid: 0, count: 0 };
      }
      byTeamMember[p.teamMemberId].totalPaid += Number(p.amount);
      byTeamMember[p.teamMemberId].count++;
    }

    return {
      payouts: allPayouts.map(p => ({ ...p, amount: Number(p.amount) })),
      summary: Object.entries(byTeamMember).map(([id, d]) => ({
        teamMemberId: id, ...d, totalPaid: round2(d.totalPaid),
      })).sort((a, b) => b.totalPaid - a.totalPaid),
    };
  }

  async getExecutiveKPIs(orgId: string) {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0];
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0];

    const sameDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).toISOString().split("T")[0];

    const thisRev_ = await this.getServiceRevenue(orgId, thisMonthStart, todayStr);
    const lastRev_ = await this.getServiceRevenue(orgId, lastMonthStart, sameDayLastMonth);

    const thisMonthCollectedVal = await this.getCollected(orgId, thisMonthStart, todayStr);

    // Payouts this month
    const thisMonthPayouts = await db
      .select({ total: sql<number>`coalesce(sum(cast(${teamMemberPayoutsV2.amount} as numeric)), 0)` })
      .from(teamMemberPayoutsV2)
      .where(and(eq(teamMemberPayoutsV2.orgId, orgId), eq(teamMemberPayoutsV2.status, "COMPLETED"), gte(teamMemberPayoutsV2.payoutDate, thisMonthStart)));

    // Total outstanding — canonical AR
    const canonicalAR = await this.getOutstandingAR(orgId);

    // Overdue count + amount
    const overdueData = await db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum((cast(${invoices.total} as numeric) - cast(${invoices.paidAmount} as numeric)) * coalesce(cast(${invoices.exchangeRate} as numeric), 1)), 0)`,
      })
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), ne(invoices.status, "PAID"), ne(invoices.status, "VOID"), ne(invoices.status, "DRAFT"), sql`${invoices.dueDate} < ${todayStr}`));

    const teamCounts = await this.getActiveTeamCount(orgId);

    // Active projects
    const activeProjectCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(and(eq(projects.orgId, orgId), eq(projects.status, "ACTIVE")));

    // Unbilled hours + value
    const unbilled = await db
      .select({
        totalMinutes: sql<number>`coalesce(sum(${timeEntries.minutes}), 0)`,
        totalValue: sql<number>`coalesce(sum(cast(${timeEntries.rate} as numeric) * ${timeEntries.minutes} / 60.0), 0)`,
      })
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.billable, true), eq(timeEntries.invoiced, false)));

    // Pending timesheets
    const pendingTimesheets = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(timesheetWeeks)
      .where(and(eq(timesheetWeeks.orgId, orgId), eq(timesheetWeeks.status, "SUBMITTED")));

    // Pending payouts
    const pendingPayouts = await db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(cast(${teamMemberPayoutsV2.amount} as numeric)), 0)`,
      })
      .from(teamMemberPayoutsV2)
      .where(and(eq(teamMemberPayoutsV2.orgId, orgId), eq(teamMemberPayoutsV2.status, "PENDING")));

    return {
      revenueThisMonth: thisRev_,
      revenueLastMonth: lastRev_,
      revenueChange: lastRev_ > 0 ? round2(((thisRev_ - lastRev_) / lastRev_) * 100) : 0,
      collectedThisMonth: thisMonthCollectedVal,
      payoutsThisMonth: round2(Number(thisMonthPayouts[0]?.total || 0)),
      netCashThisMonth: round2(thisMonthCollectedVal - Number(thisMonthPayouts[0]?.total || 0)),
      totalOutstanding: canonicalAR,
      overdueCount: Number(overdueData[0]?.count || 0),
      overdueAmount: round2(Number(overdueData[0]?.total || 0)),
      teamTotal: teamCounts.total,
      teamActive: teamCounts.active,
      teamIndependents: teamCounts.independents,
      teamEmployees: teamCounts.employees,
      activeProjects: Number(activeProjectCount[0]?.count || 0),
      unbilledHours: round2(Number(unbilled[0]?.totalMinutes || 0) / 60),
      unbilledValue: round2(Number(unbilled[0]?.totalValue || 0)),
      pendingTimesheets: Number(pendingTimesheets[0]?.count || 0),
      pendingPayoutsCount: Number(pendingPayouts[0]?.count || 0),
      pendingPayoutsAmount: round2(Number(pendingPayouts[0]?.total || 0)),
    };
  }

  async getTeamMemberEarningsTrend(orgId: string, userId: string) {
    const memberships = await db.select().from(projectMembers).where(and(eq(projectMembers.userId, userId), eq(projectMembers.orgId, orgId)));
    const costRateByProject: Record<string, number> = {};
    for (const m of memberships) {
      costRateByProject[m.projectId] = Number(m.costRateHourly) || 0;
    }

    // Get entries from last 12 months
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const startDate = `${twelveMonthsAgo.getFullYear()}-${String(twelveMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;

    const entries = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.userId, userId), gte(timeEntries.date, startDate)));

    // Group by month
    const byMonth: Record<string, { hours: number; earnings: number; billableHours: number }> = {};
    for (const e of entries) {
      const month = e.date.slice(0, 7);
      if (!byMonth[month]) byMonth[month] = { hours: 0, earnings: 0, billableHours: 0 };
      const hours = e.minutes / 60;
      byMonth[month].hours += hours;
      if (e.billable) byMonth[month].billableHours += hours;
      const rate = costRateByProject[e.projectId] || 0;
      byMonth[month].earnings += hours * rate;
    }

    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        hours: round2(data.hours),
        billableHours: round2(data.billableHours),
        earnings: round2(data.earnings),
      }));
  }

  async getTeamMemberHoursTrend(orgId: string, userId: string) {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const currentMonday = new Date(now);
    currentMonday.setDate(now.getDate() + mondayOffset);

    const weeks: { start: string; end: string }[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(currentMonday);
      d.setDate(d.getDate() - (i * 7));
      const end = new Date(d);
      end.setDate(d.getDate() + 6);
      weeks.push({ start: d.toISOString().split("T")[0], end: end.toISOString().split("T")[0] });
    }

    const startDate = weeks[0].start;
    const entries = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, orgId), eq(timeEntries.userId, userId), gte(timeEntries.date, startDate)));

    return weeks.map(w => {
      const weekEntries = entries.filter(e => e.date >= w.start && e.date <= w.end);
      let billable = 0, nonBillable = 0;
      for (const e of weekEntries) {
        if (e.billable) billable += e.minutes;
        else nonBillable += e.minutes;
      }
      return {
        weekStart: w.start,
        billableHours: round2(billable / 60),
        nonBillableHours: round2(nonBillable / 60),
        totalHours: round2((billable + nonBillable) / 60),
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // EXPENSE CATEGORIES
  // ══════════════════════════════════════════════════════════════════

  async getExpenseCategories(orgId: string) {
    return db.select().from(expenseCategories).where(eq(expenseCategories.orgId, orgId)).orderBy(asc(expenseCategories.name));
  }

  async getActiveExpenseCategories(orgId: string) {
    return db.select().from(expenseCategories).where(and(eq(expenseCategories.orgId, orgId), eq(expenseCategories.isActive, true))).orderBy(asc(expenseCategories.name));
  }

  async createExpenseCategory(data: { orgId: string; name: string; glCode?: string; description?: string }) {
    const [cat] = await db.insert(expenseCategories).values(data).returning();
    return cat;
  }

  async updateExpenseCategory(id: string, orgId: string, data: Partial<{ name: string; glCode: string; description: string; isActive: boolean }>) {
    const [cat] = await db.update(expenseCategories).set(data).where(and(eq(expenseCategories.id, id), eq(expenseCategories.orgId, orgId))).returning();
    return cat;
  }

  async deleteExpenseCategory(id: string, orgId: string) {
    // Check if any expenses reference this category
    const linked = await db.select({ count: sql<number>`count(*)::int` }).from(expenses).where(and(eq(expenses.categoryId, id), eq(expenses.orgId, orgId)));
    if (Number(linked[0]?.count) > 0) {
      throw new Error("Cannot delete category with linked expenses. Deactivate it instead.");
    }
    const [deleted] = await db.delete(expenseCategories).where(and(eq(expenseCategories.id, id), eq(expenseCategories.orgId, orgId))).returning();
    return deleted;
  }

  // ══════════════════════════════════════════════════════════════════
  // EXPENSES
  // ══════════════════════════════════════════════════════════════════

  async getExpenses(orgId: string, filters?: { userId?: string; projectId?: string; clientId?: string; status?: string; billable?: boolean; startDate?: string; endDate?: string; page?: number; pageSize?: number }) {
    const conditions = [eq(expenses.orgId, orgId)];
    if (filters?.userId) conditions.push(eq(expenses.userId, filters.userId));
    if (filters?.projectId) conditions.push(eq(expenses.projectId, filters.projectId));
    if (filters?.clientId) conditions.push(eq(expenses.clientId, filters.clientId));
    if (filters?.status) conditions.push(eq(expenses.status, filters.status as any));
    if (filters?.billable !== undefined) conditions.push(eq(expenses.billable, filters.billable));
    if (filters?.startDate) conditions.push(gte(expenses.date, filters.startDate));
    if (filters?.endDate) conditions.push(lte(expenses.date, filters.endDate));

    let query = db
      .select({
        expense: expenses,
        userName: users.name,
        categoryName: expenseCategories.name,
        projectName: projects.name,
        clientName: clients.name,
      })
      .from(expenses)
      .leftJoin(users, eq(expenses.userId, users.id))
      .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
      .leftJoin(projects, eq(expenses.projectId, projects.id))
      .leftJoin(clients, eq(expenses.clientId, clients.id))
      .where(and(...conditions))
      .orderBy(desc(expenses.date));
    const pg = paginationToLimitOffset({ page: filters?.page, pageSize: filters?.pageSize });
    if (pg) query = query.limit(pg.limit).offset(pg.offset) as typeof query;

    const rows = await query;

    return rows.map(r => ({
      ...r.expense,
      amount: Number(r.expense.amount),
      userName: r.userName,
      categoryName: r.categoryName,
      projectName: r.projectName,
      clientName: r.clientName,
    }));
  }

  async getExpenseById(id: string, orgId: string) {
    const [row] = await db
      .select({
        expense: expenses,
        userName: users.name,
        categoryName: expenseCategories.name,
        projectName: projects.name,
        clientName: clients.name,
      })
      .from(expenses)
      .leftJoin(users, eq(expenses.userId, users.id))
      .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
      .leftJoin(projects, eq(expenses.projectId, projects.id))
      .leftJoin(clients, eq(expenses.clientId, clients.id))
      .where(and(eq(expenses.id, id), eq(expenses.orgId, orgId)));

    if (!row) return undefined;
    return {
      ...row.expense,
      amount: Number(row.expense.amount),
      userName: row.userName,
      categoryName: row.categoryName,
      projectName: row.projectName,
      clientName: row.clientName,
    };
  }

  async getMyExpenses(orgId: string, userId: string) {
    return this.getExpenses(orgId, { userId });
  }

  async createExpense(data: {
    orgId: string; userId: string; amount: number | string; date: string;
    currency?: string;
    vendor?: string; description?: string; categoryId?: string | null;
    projectId?: string | null; clientId?: string | null;
    billable?: boolean; reimbursable?: boolean;
    receiptUrl?: string | null; receiptFilename?: string | null;
    additionalReceiptUrls?: string | null;
    notes?: string | null; reportId?: string | null;
  }) {
    if (await this.isDateInClosedPeriod(data.orgId, data.date)) {
      throw new Error(`Period is closed — cannot modify ${data.date}`);
    }
    const [exp] = await db.insert(expenses).values({
      ...data,
      amount: String(data.amount),
      categoryId: data.categoryId || null,
      projectId: data.projectId || null,
      clientId: data.clientId || null,
      reportId: data.reportId || null,
      receiptUrl: data.receiptUrl || null,
      receiptFilename: data.receiptFilename || null,
      additionalReceiptUrls: data.additionalReceiptUrls || null,
      notes: data.notes || null,
    }).returning();
    return { ...exp, amount: Number(exp.amount) };
  }

  async updateExpense(id: string, orgId: string, data: Partial<{
    amount: number | string; date: string; vendor: string; description: string;
    categoryId: string | null; projectId: string | null; clientId: string | null;
    billable: boolean; reimbursable: boolean;
    receiptUrl: string | null; receiptFilename: string | null;
    additionalReceiptUrls: string | null;
    notes: string | null; reportId: string | null;
    status: string;
  }>) {
    const existingExp = await this.getExpenseById(id, orgId);
    const dateToCheck = data.date || existingExp?.date;
    if (dateToCheck && await this.isDateInClosedPeriod(orgId, dateToCheck)) {
      throw new Error(`Period is closed — cannot modify ${dateToCheck}`);
    }
    if (data.categoryId) {
      const [cat] = await db.select().from(expenseCategories).where(and(eq(expenseCategories.id, data.categoryId), eq(expenseCategories.orgId, orgId)));
      if (!cat) throw new Error("Expense category not found or does not belong to this organization");
    }
    const updates: any = { ...data };
    if (data.amount !== undefined) updates.amount = String(data.amount);
    const [exp] = await db.update(expenses).set(updates).where(and(eq(expenses.id, id), eq(expenses.orgId, orgId))).returning();
    return exp ? { ...exp, amount: Number(exp.amount) } : undefined;
  }

  async deleteExpense(id: string, orgId: string) {
    const existing = await this.getExpenseById(id, orgId);
    if (existing?.date && await this.isDateInClosedPeriod(orgId, existing.date)) {
      throw new Error(`Period is closed — cannot modify ${existing.date}`);
    }
    const [exp] = await db.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.orgId, orgId), sql`${expenses.status} IN ('DRAFT', 'REJECTED')`)).returning();
    return exp;
  }

  async submitExpense(id: string, orgId: string, userId: string) {
    const exp = await this.getExpenseById(id, orgId);
    if (!exp) throw new Error("Expense not found");
    if (exp.userId !== userId) throw new Error("You can only submit your own expenses");
    if (exp.status !== "DRAFT") throw new Error("Only draft expenses can be submitted");
    return this.updateExpense(id, orgId, { status: "SUBMITTED" });
  }

  async approveExpense(id: string, orgId: string, approvedByUserId: string) {
    const [exp] = await db.update(expenses).set({
      status: "APPROVED",
      approvedByUserId,
      approvedAt: new Date(),
      rejectionReason: null,
    }).where(and(eq(expenses.id, id), eq(expenses.orgId, orgId), eq(expenses.status, "SUBMITTED"))).returning();
    return exp ? { ...exp, amount: Number(exp.amount) } : undefined;
  }

  async rejectExpense(id: string, orgId: string, approvedByUserId: string, reason: string) {
    const [exp] = await db.update(expenses).set({
      status: "REJECTED",
      approvedByUserId,
      approvedAt: new Date(),
      rejectionReason: reason,
    }).where(and(eq(expenses.id, id), eq(expenses.orgId, orgId), eq(expenses.status, "SUBMITTED"))).returning();
    return exp ? { ...exp, amount: Number(exp.amount) } : undefined;
  }

  async markExpenseReimbursed(id: string, orgId: string) {
    const [exp] = await db.update(expenses).set({ status: "REIMBURSED" }).where(and(eq(expenses.id, id), eq(expenses.orgId, orgId), eq(expenses.status, "APPROVED"))).returning();
    return exp ? { ...exp, amount: Number(exp.amount) } : undefined;
  }

  // ══════════════════════════════════════════════════════════════════
  // EXPENSE REPORTS
  // ══════════════════════════════════════════════════════════════════

  async getExpenseReports(orgId: string, userId?: string) {
    const conditions = [eq(expenseReports.orgId, orgId)];
    if (userId) conditions.push(eq(expenseReports.userId, userId));
    const rows = await db
      .select({ report: expenseReports, userName: users.name })
      .from(expenseReports)
      .leftJoin(users, eq(expenseReports.userId, users.id))
      .where(and(...conditions))
      .orderBy(desc(expenseReports.createdAt));
    return rows.map(r => ({ ...r.report, totalAmount: Number(r.report.totalAmount), userName: r.userName }));
  }

  async getExpenseReportById(id: string, orgId: string) {
    const [row] = await db
      .select({ report: expenseReports, userName: users.name })
      .from(expenseReports)
      .leftJoin(users, eq(expenseReports.userId, users.id))
      .where(and(eq(expenseReports.id, id), eq(expenseReports.orgId, orgId)));
    if (!row) return undefined;

    const reportExpenses = await this.getExpenses(orgId, {});
    const linkedExpenses = reportExpenses.filter((e: any) => e.reportId === id);

    return { ...row.report, totalAmount: Number(row.report.totalAmount), userName: row.userName, expenses: linkedExpenses };
  }

  async createExpenseReport(data: { orgId: string; userId: string; title: string; description?: string; periodStart?: string; periodEnd?: string; notes?: string | null; expenseIds?: string[] }) {
    const { expenseIds, ...reportData } = data;
    return db.transaction(async (tx) => {
      const [report] = await tx.insert(expenseReports).values({
        ...reportData,
        notes: reportData.notes || null,
      }).returning();

      if (expenseIds && expenseIds.length > 0) {
        for (const eid of expenseIds) {
          await tx.update(expenses).set({ reportId: report.id }).where(and(eq(expenses.id, eid), eq(expenses.orgId, data.orgId), eq(expenses.userId, data.userId)));
        }
        const linked = await tx.select({ amount: expenses.amount }).from(expenses).where(and(eq(expenses.reportId, report.id), eq(expenses.orgId, data.orgId)));
        const total = round2(linked.reduce((s, e) => s + Number(e.amount), 0));
        await tx.update(expenseReports).set({ totalAmount: String(total), expenseCount: linked.length }).where(and(eq(expenseReports.id, report.id), eq(expenseReports.orgId, data.orgId)));
      }

      return { ...report, totalAmount: Number(report.totalAmount) };
    });
  }

  async recalcExpenseReport(reportId: string, orgId: string) {
    const linked = await db.select({ amount: expenses.amount }).from(expenses).where(and(eq(expenses.reportId, reportId), eq(expenses.orgId, orgId)));
    const total = round2(linked.reduce((s, e) => s + Number(e.amount), 0));
    const count = linked.length;
    await db.update(expenseReports).set({ totalAmount: String(total), expenseCount: count }).where(and(eq(expenseReports.id, reportId), eq(expenseReports.orgId, orgId)));
  }

  async submitExpenseReport(id: string, orgId: string, userId: string) {
    const report = await this.getExpenseReportById(id, orgId);
    if (!report) throw new Error("Expense report not found");
    if (report.userId !== userId) throw new Error("You can only submit your own expense reports");
    if (report.status !== "DRAFT") throw new Error("Only draft reports can be submitted");

    // Submit all linked draft expenses too
    await db.update(expenses).set({ status: "SUBMITTED" }).where(and(eq(expenses.reportId, id), eq(expenses.orgId, orgId), eq(expenses.status, "DRAFT")));

    const [updated] = await db.update(expenseReports).set({ status: "SUBMITTED", submittedAt: new Date() }).where(and(eq(expenseReports.id, id), eq(expenseReports.orgId, orgId))).returning();
    return updated ? { ...updated, totalAmount: Number(updated.totalAmount) } : undefined;
  }

  async approveExpenseReport(id: string, orgId: string, approvedByUserId: string) {
    return await db.transaction(async (tx) => {
      const report = await this.getExpenseReportById(id, orgId);
      if (!report) throw new Error("Expense report not found");
      if (report.status !== "SUBMITTED") throw new Error("Only submitted reports can be approved");
      const linkedExpenses = await tx.select().from(expenses).where(and(eq(expenses.reportId, id), eq(expenses.orgId, orgId)));
      for (const exp of linkedExpenses) {
        if (exp.status === "SUBMITTED") {
          await tx.update(expenses).set({
            status: "APPROVED",
            approvedByUserId,
            approvedAt: new Date(),
            rejectionReason: null,
          }).where(and(eq(expenses.id, exp.id), eq(expenses.orgId, orgId), eq(expenses.status, "SUBMITTED")));
        }
      }

      const [updated] = await tx.update(expenseReports).set({ status: "APPROVED", approvedByUserId, approvedAt: new Date(), rejectionReason: null }).where(and(eq(expenseReports.id, id), eq(expenseReports.orgId, orgId))).returning();
      return updated ? { ...updated, totalAmount: Number(updated.totalAmount) } : undefined;
    });
  }

  async rejectExpenseReport(id: string, orgId: string, approvedByUserId: string, reason: string) {
    const report = await this.getExpenseReportById(id, orgId);
    if (!report) throw new Error("Expense report not found");
    if (report.status !== "SUBMITTED") throw new Error("Only submitted reports can be rejected");
    // Reject all linked submitted expenses
    await db.update(expenses).set({ status: "REJECTED", approvedByUserId, approvedAt: new Date(), rejectionReason: reason }).where(and(eq(expenses.reportId, id), eq(expenses.orgId, orgId), eq(expenses.status, "SUBMITTED")));

    const [updated] = await db.update(expenseReports).set({ status: "REJECTED", approvedByUserId, approvedAt: new Date(), rejectionReason: reason }).where(and(eq(expenseReports.id, id), eq(expenseReports.orgId, orgId))).returning();
    return updated ? { ...updated, totalAmount: Number(updated.totalAmount) } : undefined;
  }

  async updateExpenseReport(id: string, orgId: string, data: Partial<{ title: string; description: string; periodStart: string; periodEnd: string; notes: string | null }>) {
    const report = await this.getExpenseReportById(id, orgId);
    if (!report) throw new Error("Expense report not found");
    if (report.status !== "DRAFT" && report.status !== "REJECTED") throw new Error("Only draft or rejected reports can be edited");
    const [updated] = await db.update(expenseReports).set({ ...data, updatedAt: new Date() }).where(and(eq(expenseReports.id, id), eq(expenseReports.orgId, orgId))).returning();
    return updated ? { ...updated, totalAmount: Number(updated.totalAmount) } : undefined;
  }

  async addExpenseToReport(reportId: string, expenseId: string, orgId: string, userId: string) {
    const report = await this.getExpenseReportById(reportId, orgId);
    if (!report) throw new Error("Expense report not found");
    if (report.status !== "DRAFT" && report.status !== "REJECTED") throw new Error("Can only add expenses to draft or rejected reports");
    const expense = await this.getExpenseById(expenseId, orgId);
    if (!expense) throw new Error("Expense not found");
    if (expense.reportId && expense.reportId !== reportId) throw new Error("Expense already belongs to another report");
    await db.update(expenses).set({ reportId }).where(and(eq(expenses.id, expenseId), eq(expenses.orgId, orgId)));
    await this.recalcExpenseReport(reportId, orgId);
  }

  async removeExpenseFromReport(reportId: string, expenseId: string, orgId: string) {
    const report = await this.getExpenseReportById(reportId, orgId);
    if (!report) throw new Error("Expense report not found");
    if (report.status !== "DRAFT" && report.status !== "REJECTED") throw new Error("Can only remove expenses from draft or rejected reports");
    await db.update(expenses).set({ reportId: null }).where(and(eq(expenses.id, expenseId), eq(expenses.orgId, orgId), eq(expenses.reportId, reportId)));
    await this.recalcExpenseReport(reportId, orgId);
  }

  async reopenExpenseReport(
    id: string,
    orgId: string,
    reopenedByUserId: string,
  ): Promise<(Omit<typeof expenseReports.$inferSelect, "totalAmount"> & { totalAmount: number; previousStatus: "SUBMITTED" | "APPROVED" }) | undefined> {
    return await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(expenseReports)
        .where(and(eq(expenseReports.id, id), eq(expenseReports.orgId, orgId)))
        .for("update");
      if (!locked) return undefined;
      if (locked.status !== "APPROVED" && locked.status !== "SUBMITTED") {
        throw new Error(`Cannot re-open: expense report is ${locked.status}. Only submitted or approved reports can be re-opened.`);
      }

      // Roll any linked SUBMITTED/APPROVED expenses back to DRAFT so the rep can edit and resubmit.
      // Skip REIMBURSED (money already moved) and REJECTED (already needs the rep's attention).
      await tx.update(expenses).set({
        status: "DRAFT",
        approvedByUserId: null,
        approvedAt: null,
        rejectionReason: null,
      }).where(and(
        eq(expenses.reportId, id),
        eq(expenses.orgId, orgId),
        inArray(expenses.status, ["SUBMITTED", "APPROVED"]),
      ));

      const [updated] = await tx.update(expenseReports).set({
        status: "DRAFT",
        approvedByUserId: null,
        approvedAt: null,
        rejectionReason: null,
        submittedAt: null,
        updatedAt: new Date(),
      }).where(and(eq(expenseReports.id, id), eq(expenseReports.orgId, orgId))).returning();

      if (!updated) return undefined;
      return { ...updated, totalAmount: Number(updated.totalAmount), previousStatus: locked.status };
    });
  }

  async reimburseExpenseReport(id: string, orgId: string, userId: string) {
    const report = await this.getExpenseReportById(id, orgId);
    if (!report) throw new Error("Expense report not found");
    if (report.status !== "APPROVED") throw new Error("Only approved reports can be reimbursed");
    await db.update(expenses).set({ status: "REIMBURSED" }).where(and(eq(expenses.reportId, id), eq(expenses.orgId, orgId), eq(expenses.status, "APPROVED")));
    const [updated] = await db.update(expenseReports).set({ status: "REIMBURSED", reimbursedAt: new Date(), updatedAt: new Date() }).where(and(eq(expenseReports.id, id), eq(expenseReports.orgId, orgId))).returning();
    return updated ? { ...updated, totalAmount: Number(updated.totalAmount) } : undefined;
  }

  // ══════════════════════════════════════════════════════════════════
  // EXPENSE REPORTING QUERIES
  // ══════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════
  // EXPENSE INTEGRATION METHODS
  // ══════════════════════════════════════════════════════════════════

  async getBillableExpensesForClient(orgId: string, clientId: string) {
    return db
      .select({
        expense: expenses,
        projectName: projects.name,
        userName: users.name,
        categoryName: expenseCategories.name,
      })
      .from(expenses)
      .leftJoin(projects, eq(expenses.projectId, projects.id))
      .leftJoin(users, eq(expenses.userId, users.id))
      .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
      .where(
        and(
          eq(expenses.orgId, orgId),
          eq(expenses.clientId, clientId),
          eq(expenses.billable, true),
          eq(expenses.invoiced, false),
          eq(expenses.status, "APPROVED"),
        ),
      );
  }

  async markExpensesInvoiced(expenseIds: string[], invoiceLineId: string, orgId: string) {
    if (!expenseIds.length) return;
    for (const id of expenseIds) {
      await db
        .update(expenses)
        .set({ invoiced: true, invoiceLineId })
        .where(and(eq(expenses.id, id), eq(expenses.orgId, orgId)));
    }
  }

  async getProjectExpenseTotal(orgId: string, projectId: string, startDate?: string, endDate?: string) {
    const conditions = [
      eq(expenses.orgId, orgId),
      eq(expenses.projectId, projectId),
      ne(expenses.status, "REJECTED" as any),
    ];
    if (startDate) conditions.push(gte(expenses.date, startDate));
    if (endDate) conditions.push(lte(expenses.date, endDate));

    const [result] = await db
      .select({
        total: sql<number>`coalesce(sum(cast(${expenses.amount} as numeric)), 0)`,
        count: sql<number>`count(*)::int`,
        billableTotal: sql<number>`coalesce(sum(case when ${expenses.billable} then cast(${expenses.amount} as numeric) else 0 end), 0)`,
        reimbursableTotal: sql<number>`coalesce(sum(case when ${expenses.reimbursable} then cast(${expenses.amount} as numeric) else 0 end), 0)`,
      })
      .from(expenses)
      .where(and(...conditions));

    return {
      total: round2(Number(result?.total || 0)),
      count: Number(result?.count || 0),
      billableTotal: round2(Number(result?.billableTotal || 0)),
      reimbursableTotal: round2(Number(result?.reimbursableTotal || 0)),
    };
  }

  async getExpenseSummaryByCategory(orgId: string, startDate?: string, endDate?: string) {
    const conditions = [eq(expenses.orgId, orgId), ne(expenses.status, "REJECTED" as any)];
    if (startDate) conditions.push(gte(expenses.date, startDate));
    if (endDate) conditions.push(lte(expenses.date, endDate));

    return db
      .select({
        categoryId: expenses.categoryId,
        categoryName: expenseCategories.name,
        totalAmount: sql<number>`coalesce(sum(cast(${expenses.amount} as numeric)), 0)`,
        count: sql<number>`count(*)::int`,
        billableAmount: sql<number>`coalesce(sum(case when ${expenses.billable} then cast(${expenses.amount} as numeric) else 0 end), 0)`,
        reimbursableAmount: sql<number>`coalesce(sum(case when ${expenses.reimbursable} then cast(${expenses.amount} as numeric) else 0 end), 0)`,
      })
      .from(expenses)
      .leftJoin(expenseCategories, eq(expenses.categoryId, expenseCategories.id))
      .where(and(...conditions))
      .groupBy(expenses.categoryId, expenseCategories.name)
      .orderBy(sql`coalesce(sum(cast(${expenses.amount} as numeric)), 0) desc`);
  }

  async getExpenseSummaryByProject(orgId: string) {
    const conditions = [eq(expenses.orgId, orgId), ne(expenses.status, "REJECTED" as any)];
    return db
      .select({
        projectId: expenses.projectId,
        projectName: projects.name,
        clientName: clients.name,
        totalAmount: sql<number>`coalesce(sum(cast(${expenses.amount} as numeric)), 0)`,
        billableAmount: sql<number>`coalesce(sum(case when ${expenses.billable} then cast(${expenses.amount} as numeric) else 0 end), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(expenses)
      .leftJoin(projects, eq(expenses.projectId, projects.id))
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(and(...conditions))
      .groupBy(expenses.projectId, projects.name, clients.name)
      .orderBy(sql`coalesce(sum(cast(${expenses.amount} as numeric)), 0) desc`);
  }

  async getExpenseSummaryByUser(orgId: string) {
    const conditions = [eq(expenses.orgId, orgId), ne(expenses.status, "REJECTED" as any)];
    return db
      .select({
        userId: expenses.userId,
        userName: users.name,
        totalAmount: sql<number>`coalesce(sum(cast(${expenses.amount} as numeric)), 0)`,
        reimbursableAmount: sql<number>`coalesce(sum(case when ${expenses.reimbursable} then cast(${expenses.amount} as numeric) else 0 end), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(expenses)
      .leftJoin(users, eq(expenses.userId, users.id))
      .where(and(...conditions))
      .groupBy(expenses.userId, users.name)
      .orderBy(sql`coalesce(sum(cast(${expenses.amount} as numeric)), 0) desc`);
  }

  async resetTestData() {
    await db.delete(expenses);
    await db.delete(expenseReports);
    await db.delete(expenseCategories);
    await db.delete(estimateLines);
    await db.delete(estimates);
    await db.delete(importedPayouts);
    await db.delete(importedKeys);
    await db.delete(importFiles);
    await db.delete(importRuns);
    await db.delete(stripeEvents);
    await db.delete(auditLogs);
    await db.delete(outboxEmails);
    await db.delete(payments);
    await db.delete(invoiceRevisions);
    await db.delete(invoiceLines);
    await db.delete(invoices);
    await db.delete(recurringInvoiceTemplates);
    await db.delete(timesheetWeeks);
    await db.delete(timeEntries);
    await db.delete(projectMembers);
    await db.delete(services);
    await db.delete(projects);
    await db.delete(clients);
    await db.delete(users);
    await db.delete(orgs);
  }

  async getGLAccountsByOrg(orgId: string, includeArchived = false): Promise<GlAccount[]> {
    const conditions = [eq(glAccounts.orgId, orgId)];
    if (!includeArchived) {
      conditions.push(eq(glAccounts.isActive, true));
    }
    return db.select().from(glAccounts).where(and(...conditions)).orderBy(asc(glAccounts.accountNumber));
  }

  async createGLAccount(data: InsertGlAccount): Promise<GlAccount> {
    const [account] = await db.insert(glAccounts).values(data).returning();
    return account;
  }

  async updateGLAccount(id: number, orgId: string, data: Partial<GlAccount>): Promise<GlAccount> {
    const [account] = await db.update(glAccounts).set(data).where(and(eq(glAccounts.id, id), eq(glAccounts.orgId, orgId))).returning();
    return account;
  }

  async archiveGLAccount(id: number, orgId: string): Promise<GlAccount> {
    const [account] = await db.update(glAccounts).set({ isActive: false }).where(and(eq(glAccounts.id, id), eq(glAccounts.orgId, orgId))).returning();
    return account;
  }

  async createGLJournalEntry(
    orgId: string,
    entryDate: string,
    memo: string | null,
    sourceType: string | null,
    sourceId: number | null,
    isAutoGenerated: boolean,
    createdByUserId: string | null,
    lines: { accountId: number; debit: string; credit: string; memo?: string | null }[],
    sourceRef?: string | null,
  ): Promise<GlJournalEntry & { lines: GlJournalLine[] }> {
    if (sourceRef) {
      const existing = await db.select().from(glJournalEntries)
        .where(and(eq(glJournalEntries.orgId, orgId), eq(glJournalEntries.sourceRef, sourceRef)))
        .limit(1);
      if (existing.length > 0) {
        console.log(`[gl] Skipping duplicate journal entry: orgId=${orgId}, sourceRef=${sourceRef}`);
        const existingLines = await db.select().from(glJournalLines)
          .where(and(eq(glJournalLines.journalEntryId, existing[0].id), eq(glJournalLines.orgId, orgId)))
          .orderBy(asc(glJournalLines.id));
        return { ...existing[0], lines: existingLines };
      }
    }

    const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit || 0), 0);
    const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.005) {
      throw new Error(`GL entry must balance: debits (${totalDebit.toFixed(2)}) must equal credits (${totalCredit.toFixed(2)})`);
    }

    if (await this.isDateInClosedPeriod(orgId, entryDate)) {
      throw new Error(`Cannot post journal entry: ${entryDate} falls in a closed accounting period`);
    }

    return await db.transaction(async (tx) => {
      const [entry] = await tx.insert(glJournalEntries).values({
        orgId,
        entryDate,
        memo,
        sourceType,
        sourceId,
        sourceRef: sourceRef ?? null,
        isAutoGenerated,
        isReversing: false,
        createdByUserId,
      }).returning();

      const insertedLines: GlJournalLine[] = [];
      for (const line of lines) {
        const [inserted] = await tx.insert(glJournalLines).values({
          orgId,
          journalEntryId: entry.id,
          accountId: line.accountId,
          debit: line.debit,
          credit: line.credit,
          memo: line.memo ?? null,
        }).returning();
        insertedLines.push(inserted);
      }

      return { ...entry, lines: insertedLines };
    });
  }

  /** Direct, unpaginated existence check for a journal entry by source. */
  async hasGLEntryForSource(orgId: string, sourceType: string, sourceRef: string): Promise<boolean> {
    const [row] = await db
      .select({ id: glJournalEntries.id })
      .from(glJournalEntries)
      .where(and(
        eq(glJournalEntries.orgId, orgId),
        eq(glJournalEntries.sourceType, sourceType),
        eq(glJournalEntries.sourceRef, sourceRef),
      ))
      .limit(1);
    return !!row;
  }

  async getGLJournalEntriesByOrg(
    orgId: string,
    filters?: { startDate?: string; endDate?: string; sourceType?: string; accountId?: number },
    limit: number = 500,
    offset: number = 0,
  ): Promise<(GlJournalEntry & { lines: GlJournalLine[] })[]> {
    const conditions = [eq(glJournalEntries.orgId, orgId)];

    if (filters?.startDate) {
      conditions.push(gte(glJournalEntries.entryDate, filters.startDate));
    }
    if (filters?.endDate) {
      conditions.push(lte(glJournalEntries.entryDate, filters.endDate));
    }
    if (filters?.sourceType) {
      conditions.push(eq(glJournalEntries.sourceType, filters.sourceType));
    }

    const hardLimit = 10000;
    let entries = await db
      .select()
      .from(glJournalEntries)
      .where(and(...conditions))
      .orderBy(desc(glJournalEntries.entryDate), desc(glJournalEntries.id))
      .limit(hardLimit);

    if (filters?.accountId) {
      const entryIdsWithAccount = await db
        .select({ journalEntryId: glJournalLines.journalEntryId })
        .from(glJournalLines)
        .where(eq(glJournalLines.accountId, filters.accountId));
      const matchingIds = new Set(entryIdsWithAccount.map(r => r.journalEntryId));
      entries = entries.filter(e => matchingIds.has(e.id));
    }

    entries = entries.slice(offset, offset + limit);

    const results: (GlJournalEntry & { lines: GlJournalLine[] })[] = [];
    for (const entry of entries) {
      const lines = await db
        .select()
        .from(glJournalLines)
        .where(and(eq(glJournalLines.journalEntryId, entry.id), eq(glJournalLines.orgId, orgId)))
        .orderBy(asc(glJournalLines.id));
      results.push({ ...entry, lines });
    }
    return results;
  }

  async getGLJournalEntryById(id: number, orgId: string): Promise<(GlJournalEntry & { lines: GlJournalLine[] }) | undefined> {
    const [entry] = await db.select().from(glJournalEntries).where(and(eq(glJournalEntries.id, id), eq(glJournalEntries.orgId, orgId)));
    if (!entry) return undefined;
    const lineConditions = [eq(glJournalLines.journalEntryId, entry.id), eq(glJournalLines.orgId, orgId)];
    const lines = await db
      .select()
      .from(glJournalLines)
      .where(and(...lineConditions))
      .orderBy(asc(glJournalLines.id));
    return { ...entry, lines };
  }

  async seedDefaultGLAccounts(orgId: string): Promise<void> {
    const existing = await db.select().from(glAccounts).where(eq(glAccounts.orgId, orgId)).limit(1);
    if (existing.length > 0) return;

    // Default chart of accounts. Numbering scheme:
    //   1xxx Assets          2xxx Liabilities       3xxx Equity
    //   4xxx Revenue         5xxx Cost of Services
    //   6001–6009 Operating expenses (must stay in sync with seed.ts expense categories):
    //     6001 Travel           6004 Meals & Entertainment   6007 Insurance
    //     6002 Software & Subs  6005 Professional Dev        6008 Rent & Facilities
    //     6003 Office Supplies  6006 Marketing & Advertising 6009 Miscellaneous Expense
    const defaults: InsertGlAccount[] = [
      { orgId, accountNumber: "1000", name: "Cash - Operating", accountType: "ASSET", normalBalance: "DEBIT", isSystem: true },
      { orgId, accountNumber: "1200", name: "Accounts Receivable", accountType: "ASSET", normalBalance: "DEBIT", isSystem: true },
      { orgId, accountNumber: "2000", name: "Accounts Payable", accountType: "LIABILITY", normalBalance: "CREDIT", isSystem: true },
      { orgId, accountNumber: "2100", name: "Accrued Team Member Payable", accountType: "LIABILITY", normalBalance: "CREDIT", isSystem: true },
      { orgId, accountNumber: "2200", name: "Accrued Employee Reimbursable", accountType: "LIABILITY", normalBalance: "CREDIT", isSystem: true },
      { orgId, accountNumber: "2300", name: "Sales Tax Payable", accountType: "LIABILITY", normalBalance: "CREDIT", isSystem: true },
      { orgId, accountNumber: "3000", name: "Owners Equity", accountType: "EQUITY", normalBalance: "CREDIT", isSystem: true },
      { orgId, accountNumber: "4000", name: "Service Revenue", accountType: "REVENUE", normalBalance: "CREDIT", isSystem: true },
      // Contra-revenue: a REVENUE account with a DEBIT normal balance, so it nets
      // against 4000 in the trial balance. Used to keep discounted invoices'
      // journal entries balanced (audit #6/7/15/16). Existing orgs receive this
      // via migrations/0029-gl-sales-discounts-account.sql (seedDefaultGLAccounts
      // only seeds orgs with no chart yet).
      { orgId, accountNumber: "4100", name: "Sales Discounts", accountType: "REVENUE", normalBalance: "DEBIT", isSystem: true },
      { orgId, accountNumber: "5100", name: "Team Payout Costs", accountType: "COST_OF_SERVICES", normalBalance: "DEBIT", isSystem: true },
      { orgId, accountNumber: "6001", name: "Travel", accountType: "EXPENSE", normalBalance: "DEBIT", isSystem: true },
      { orgId, accountNumber: "6002", name: "Software & Subscriptions", accountType: "EXPENSE", normalBalance: "DEBIT", isSystem: true },
      { orgId, accountNumber: "6003", name: "Office Supplies", accountType: "EXPENSE", normalBalance: "DEBIT", isSystem: true },
      { orgId, accountNumber: "6004", name: "Meals & Entertainment", accountType: "EXPENSE", normalBalance: "DEBIT", isSystem: true },
      { orgId, accountNumber: "6005", name: "Professional Development", accountType: "EXPENSE", normalBalance: "DEBIT", isSystem: true },
      { orgId, accountNumber: "6006", name: "Marketing & Advertising", accountType: "EXPENSE", normalBalance: "DEBIT", isSystem: true },
      { orgId, accountNumber: "6007", name: "Insurance", accountType: "EXPENSE", normalBalance: "DEBIT", isSystem: true },
      { orgId, accountNumber: "6008", name: "Rent & Facilities", accountType: "EXPENSE", normalBalance: "DEBIT", isSystem: true },
      { orgId, accountNumber: "6009", name: "Miscellaneous Expense", accountType: "EXPENSE", normalBalance: "DEBIT", isSystem: true },
    ];

    await db.insert(glAccounts).values(defaults);
  }

  async createBankConnection(data: InsertBankConnection): Promise<BankConnection> {
    const [conn] = await db.insert(bankConnections).values(data).returning();
    return conn;
  }

  async getBankConnectionsByOrg(orgId: string): Promise<BankConnection[]> {
    return db.select().from(bankConnections).where(eq(bankConnections.orgId, orgId)).orderBy(desc(bankConnections.createdAt));
  }

  async getBankConnectionById(id: number): Promise<BankConnection | undefined> {
    const [conn] = await db.select().from(bankConnections).where(eq(bankConnections.id, id));
    return conn;
  }

  async updateBankConnection(id: number, data: Partial<InsertBankConnection>): Promise<BankConnection> {
    const [conn] = await db.update(bankConnections).set({ ...data, updatedAt: new Date() }).where(eq(bankConnections.id, id)).returning();
    return conn;
  }

  async deleteBankConnection(id: number, orgId: string): Promise<void> {
    await db.delete(bankTransactionMatches).where(
      sql`${bankTransactionMatches.bankTransactionId} IN (SELECT id FROM bank_transactions WHERE bank_connection_id = ${id})`
    );
    await db.delete(bankTransactions).where(eq(bankTransactions.bankConnectionId, id));
    await db.delete(bankReconciliationLogs).where(eq(bankReconciliationLogs.bankConnectionId, id));
    await db.delete(bankConnections).where(and(eq(bankConnections.id, id), eq(bankConnections.orgId, orgId)));
  }

  async createBankTransaction(data: InsertBankTransaction): Promise<BankTransaction> {
    const [tx] = await db.insert(bankTransactions).values(data).returning();
    return tx;
  }

  async createBankTransactions(data: InsertBankTransaction[]): Promise<BankTransaction[]> {
    if (data.length === 0) return [];
    return db.insert(bankTransactions).values(data).returning();
  }

  async getBankTransactionsByConnection(connectionId: number): Promise<BankTransaction[]> {
    return db.select().from(bankTransactions).where(eq(bankTransactions.bankConnectionId, connectionId)).orderBy(desc(bankTransactions.date));
  }

  async getBankTransactionsByOrg(orgId: string, limit: number = 500, offset: number = 0): Promise<BankTransaction[]> {
    return db.select().from(bankTransactions)
      .where(eq(bankTransactions.orgId, orgId))
      .orderBy(desc(bankTransactions.date))
      .limit(limit)
      .offset(offset);
  }

  async getBankTransaction(id: number, orgId: string): Promise<BankTransaction | undefined> {
    const [row] = await db.select().from(bankTransactions)
      .where(and(eq(bankTransactions.id, id), eq(bankTransactions.orgId, orgId)))
      .limit(1);
    return row;
  }

  async updateBankTransaction(id: number, data: Partial<InsertBankTransaction>): Promise<BankTransaction> {
    const [tx] = await db.update(bankTransactions).set(data).where(eq(bankTransactions.id, id)).returning();
    return tx;
  }

  async createBankTransactionMatch(data: InsertBankTransactionMatch): Promise<BankTransactionMatch> {
    const [match] = await db.insert(bankTransactionMatches).values(data).returning();
    return match;
  }

  async getBankTransactionMatchesByOrg(orgId: string): Promise<BankTransactionMatch[]> {
    return db.select().from(bankTransactionMatches)
      .where(eq(bankTransactionMatches.orgId, orgId))
      .orderBy(desc(bankTransactionMatches.createdAt))
      .limit(1000);
  }

  async getBankTransactionMatchesByTransaction(txId: number): Promise<BankTransactionMatch[]> {
    return db.select().from(bankTransactionMatches).where(eq(bankTransactionMatches.bankTransactionId, txId));
  }

  async getBankTransactionMatchById(id: number): Promise<BankTransactionMatch | undefined> {
    const [match] = await db.select().from(bankTransactionMatches).where(eq(bankTransactionMatches.id, id));
    return match;
  }

  async deleteBankTransactionMatch(id: number, orgId: string): Promise<void> {
    await db.delete(bankTransactionMatches).where(and(eq(bankTransactionMatches.id, id), eq(bankTransactionMatches.orgId, orgId)));
  }

  async deleteBankTransactionMatchesByTransaction(txId: number): Promise<void> {
    await db.delete(bankTransactionMatches).where(eq(bankTransactionMatches.bankTransactionId, txId));
  }

  async createBankReconciliationLog(data: InsertBankReconciliationLog): Promise<BankReconciliationLog> {
    const [log] = await db.insert(bankReconciliationLogs).values(data).returning();
    return log;
  }

  async getBankReconciliationLogsByOrg(orgId: string): Promise<BankReconciliationLog[]> {
    return db.select().from(bankReconciliationLogs).where(eq(bankReconciliationLogs.orgId, orgId)).orderBy(desc(bankReconciliationLogs.reconciledAt));
  }

  async createPendingInvite(data: InsertPendingInvite): Promise<PendingInvite> {
    const [invite] = await db.insert(pendingInvites).values(data).returning();
    return invite;
  }

  async getPendingInviteById(id: string, orgId: string): Promise<PendingInvite | undefined> {
    const [invite] = await db
      .select()
      .from(pendingInvites)
      .where(and(eq(pendingInvites.id, id), eq(pendingInvites.orgId, orgId)));
    return invite;
  }

  async getPendingInviteByToken(token: string): Promise<PendingInvite | undefined> {
    const [invite] = await db
      .select()
      .from(pendingInvites)
      .where(eq(pendingInvites.inviteToken, token));
    return invite;
  }

  async getPendingInvitesByOrg(orgId: string): Promise<PendingInvite[]> {
    await db
      .update(pendingInvites)
      .set({ status: "EXPIRED" })
      .where(
        and(
          eq(pendingInvites.orgId, orgId),
          eq(pendingInvites.status, "PENDING"),
          lte(pendingInvites.expiresAt, new Date()),
        )
      );
    return db
      .select()
      .from(pendingInvites)
      .where(eq(pendingInvites.orgId, orgId))
      .orderBy(desc(pendingInvites.createdAt));
  }

  async updatePendingInvite(id: string, orgId: string, data: Partial<PendingInvite>): Promise<PendingInvite | undefined> {
    const [invite] = await db
      .update(pendingInvites)
      .set(data)
      .where(and(eq(pendingInvites.id, id), eq(pendingInvites.orgId, orgId)))
      .returning();
    return invite;
  }

  // ──────────────────────────────────────────────────────────────────
  // Marketing OS — Sprint 1: Brand CRUD
  // Tenant isolation: every (id, orgId) check uses
  // and(eq(brands.id, id), eq(brands.orgId, orgId)) — mirrors
  // getClientById/updateClient at lines ~367-390 above.
  // ──────────────────────────────────────────────────────────────────
  async listBrandsByOrg(orgId: string): Promise<BrandWithStats[]> {
    // Task #162: serve from a short-lived in-memory cache when fresh.
    // Mutations that change either aggregate invalidate the entry; the
    // TTL bounds staleness for any uncovered direct-DB mutation path.
    const cached = brandStatsCache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    // One round-trip: brands LEFT JOIN two grouped subqueries (per-brand
    // contact count + per-brand max(occurred_at) for "sent" activities).
    // Both subqueries are pre-filtered by orgId so they piggy-back on the
    // existing (org_id, brand_id, ...) composite indexes on
    // client_contacts / contact_activities — no full scan.
    // Sprint 2o.0 5b1c.1 (Blocker A): contactCount counts marketing_prospects
    // (the marketing surface), not PSO client_contacts. Pre-fix this stat was
    // computed off PSO and read 0 on marketing-only orgs post-5a.
    const contactCountSq = db
      .select({
        brandId: marketingProspects.brandId,
        contactCount: sql<number>`count(*)::int`.as("contact_count"),
      })
      .from(marketingProspects)
      .where(
        and(
          eq(marketingProspects.orgId, orgId),
          isNotNull(marketingProspects.brandId),
          isNull(marketingProspects.deletedAt),
        ),
      )
      .groupBy(marketingProspects.brandId)
      .as("cc");

    const lastSentSq = db
      .select({
        brandId: contactActivities.brandId,
        lastSentAt: sql<Date>`max(${contactActivities.occurredAt})`.as(
          "last_sent_at",
        ),
      })
      .from(contactActivities)
      .where(
        and(
          eq(contactActivities.orgId, orgId),
          isNotNull(contactActivities.brandId),
          inArray(contactActivities.type, ["email_sent", "email_manual"]),
        ),
      )
      .groupBy(contactActivities.brandId)
      .as("ls");

    const rows = await db
      .select({
        id: brands.id,
        orgId: brands.orgId,
        name: brands.name,
        slug: brands.slug,
        logoUrl: brands.logoUrl,
        primaryColor: brands.primaryColor,
        domain: brands.domain,
        fromEmail: brands.fromEmail,
        fromName: brands.fromName,
        replyTo: brands.replyTo,
        signatureHtml: brands.signatureHtml,
        active: brands.active,
        createdAt: brands.createdAt,
        updatedAt: brands.updatedAt,
        contactCount: sql<number>`coalesce(${contactCountSq.contactCount}, 0)::int`,
        lastSentAt: lastSentSq.lastSentAt,
      })
      .from(brands)
      .leftJoin(contactCountSq, eq(contactCountSq.brandId, brands.id))
      .leftJoin(lastSentSq, eq(lastSentSq.brandId, brands.id))
      .where(eq(brands.orgId, orgId))
      .orderBy(desc(brands.createdAt));

    const result = rows as BrandWithStats[];
    brandStatsCache.set(orgId, {
      data: result,
      expiresAt: Date.now() + BRAND_STATS_CACHE_TTL_MS,
    });
    return result;
  }

  async getBrand(id: string, orgId: string): Promise<Brand | undefined> {
    const [brand] = await db
      .select()
      .from(brands)
      .where(and(eq(brands.id, id), eq(brands.orgId, orgId)));
    return brand;
  }

  async createBrand(data: InsertBrand): Promise<Brand> {
    const [brand] = await db.insert(brands).values(data).returning();
    invalidateBrandStatsCache(brand.orgId);
    return brand;
  }

  async updateBrand(
    id: string,
    orgId: string,
    data: Partial<InsertBrand>,
  ): Promise<Brand | undefined> {
    const [brand] = await db
      .update(brands)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(brands.id, id), eq(brands.orgId, orgId)))
      .returning();
    if (brand) invalidateBrandStatsCache(orgId);
    return brand;
  }

  async softDeleteBrand(
    id: string,
    orgId: string,
  ): Promise<Brand | undefined> {
    const [brand] = await db
      .update(brands)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(brands.id, id), eq(brands.orgId, orgId)))
      .returning();
    if (brand) invalidateBrandStatsCache(orgId);
    return brand;
  }

  // ──────────────────────────────────────────────────────────────────
  // Marketing OS — Sprint 2a: Contacts foundation
  // All methods are tenant-isolated via (orgId), and brand-scoped via
  // (brandId) where the caller passes one. Soft-deleted contacts
  // (deleted_at IS NOT NULL) are excluded by default in list queries.
  // ──────────────────────────────────────────────────────────────────

  /**
   * List contacts for a single org+brand with optional filters and tag join.
   * Returns each contact augmented with `tags: ContactTag[]`.
   *
   * Filters:
   *  - lifecycleStage / leadStatus → exact match
   *  - search → ILIKE on first_name|last_name|email|company_name|title
   *  - tagIds  → contact must have ALL listed tag ids (AND)
   *  - deleted → 'exclude' (default) | 'only' | 'all'
   *  - clientId → exact match (for cross-link from /clients/:id)
   */
  // Sprint 2o.0 (5b1c.1): listContactsByOrg → listProspectsByFilter.
  // Case 1 MARKETING-ONLY rename + in-place retarget to marketingProspects.
  // Drops PSO-only filters (leadStatus, clientId, source, companyName ILIKE);
  // those have no analogue on the marketing surface.
  async listProspectsByFilter(
    orgId: string,
    brandId: string | null,
    filters: {
      lifecycleStage?: string;
      search?: string;
      tagIds?: string[];
      deleted?: "exclude" | "only" | "all";
    } = {},
    pagination: { limit?: number; offset?: number } = {},
  ): Promise<Array<MarketingProspect & { tags: ContactTag[] }>> {
    const limit = Math.min(Math.max(pagination.limit ?? 50, 1), 500);
    const offset = Math.max(pagination.offset ?? 0, 0);

    const wheres: SQL[] = [eq(marketingProspects.orgId, orgId)];
    if (brandId) wheres.push(eq(marketingProspects.brandId, brandId));
    if (filters.lifecycleStage) {
      wheres.push(eq(marketingProspects.lifecycleStage, filters.lifecycleStage as MarketingProspectLifecycleStage));
    }

    const del = filters.deleted ?? "exclude";
    if (del === "exclude") wheres.push(isNull(marketingProspects.deletedAt));
    else if (del === "only") wheres.push(isNotNull(marketingProspects.deletedAt));

    if (filters.search && filters.search.trim()) {
      const s = `%${filters.search.trim()}%`;
      wheres.push(
        or(
          ilike(marketingProspects.firstName, s),
          ilike(marketingProspects.lastName, s),
          ilike(marketingProspects.email, s),
          ilike(marketingProspects.title, s),
        )!,
      );
    }

    if (filters.tagIds && filters.tagIds.length > 0) {
      // Prospect must have ALL specified tags (AND semantics).
      const sub = db
        .select({ prospectId: contactTagAssignments.prospectId })
        .from(contactTagAssignments)
        .where(inArray(contactTagAssignments.tagId, filters.tagIds))
        .groupBy(contactTagAssignments.prospectId)
        .having(sql`count(distinct ${contactTagAssignments.tagId}) = ${filters.tagIds.length}`);
      wheres.push(inArray(marketingProspects.id, sub));
    }

    const rows = await db
      .select()
      .from(marketingProspects)
      .where(and(...wheres))
      .orderBy(desc(marketingProspects.lastActivityAt), desc(marketingProspects.createdAt))
      .limit(limit)
      .offset(offset);

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const tagRows = await db
      .select({
        prospectId: contactTagAssignments.prospectId,
        tag: contactTags,
      })
      .from(contactTagAssignments)
      .innerJoin(contactTags, eq(contactTags.id, contactTagAssignments.tagId))
      .where(and(
        inArray(contactTagAssignments.prospectId, ids),
        eq(contactTags.orgId, orgId),
      ));

    const tagMap = new Map<string, ContactTag[]>();
    for (const t of tagRows) {
      const arr = tagMap.get(t.prospectId) ?? [];
      arr.push(t.tag);
      tagMap.set(t.prospectId, arr);
    }

    return rows.map((r) => ({ ...r, tags: tagMap.get(r.id) ?? [] }));
  }

  /**
   * Fetch a single contact (tenant-scoped) plus its tags.
   * Returns undefined if not found OR if it belongs to a different org.
   */
  async getContact(
    id: string,
    orgId: string,
  ): Promise<typeof clientContacts.$inferSelect | undefined> {
    // Sprint 2o.0 Step 5b1e (HR4): tag-block ripout. PSO clientContacts do
    // NOT use tags anywhere in the UI — all tagging surfaces bind to
    // marketingProspects via the prospect-aware helpers. The legacy
    // contactTagAssignments.contactId join was removed in Step 5b1e ahead of
    // the Step 5b2 column drop (Dropped in Step 5b2 on 2026-04-23). Return
    // shape narrows from `& { tags: ContactTag[] }` to the bare select; dead-
    // code analysis (5b1e pre-flight) confirmed zero callers of this method
    // consume `.tags`.
    const [contact] = await db
      .select()
      .from(clientContacts)
      .where(and(eq(clientContacts.id, id), eq(clientContacts.orgId, orgId)));
    return contact;
  }

  async createContact(
    data: typeof clientContacts.$inferInsert,
    opts: { actorId?: string | null; emitCreated?: boolean } = {},
  ): Promise<typeof clientContacts.$inferSelect> {
    // Sprint 2f: contact INSERT + `contact_created` system emission run in a
    // single tx so a failed emission rolls back the contact. CSV import
    // passes emitCreated=false because it emits one `imported` summary row
    // per batch instead of N `contact_created` rows.
    const emit = opts.emitCreated !== false;
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(clientContacts).values(data).returning();
      // Single-primary invariant: a contact set as primary demotes the client's
      // other primaries, so the recipient resolver's "primary contact" is unambiguous.
      if (inserted.isPrimary && inserted.clientId) {
        await tx
          .update(clientContacts)
          .set({ isPrimary: false, updatedAt: new Date() })
          .where(and(
            eq(clientContacts.clientId, inserted.clientId),
            eq(clientContacts.orgId, inserted.orgId),
            ne(clientContacts.id, inserted.id),
            eq(clientContacts.isPrimary, true),
          ));
      }
      if (emit) {
        // Sprint 2o.0 Step 5b1e (HR4): retargeted from contact_activities
        // (legacy PSO contactId path being dropped in 5b2) to the new
        // PSO-only pso_contact_activities table. NO brandId — PSO has no
        // brand surface per HR4. Stays inside the contact-create tx so a
        // failed emission rolls the contact insert back, preserving Sprint
        // 2f atomicity.
        await tx.insert(psoContactActivities).values({
          orgId: inserted.orgId,
          clientContactId: inserted.id,
          companyId: inserted.companyId ?? null,
          type: "contact_created" satisfies PsoContactActivityType,
          payload: {},
          actorId: opts.actorId ?? null,
        });
      }
      return inserted;
    });
    // Task #162: a new contact bumps the per-brand contact count.
    invalidateBrandStatsCache(row.orgId);
    // Sprint 2b: SET-ONLY auto-link to company by email domain. Skip when
    // the caller explicitly provided a companyId (link OR explicit unlink) —
    // the user's intent must not be overwritten. Auto-link runs AFTER the
    // tx commits because it's an idempotent post-step (its own `company_linked`
    // emission is internal to maybeAutoLinkContactCompany).
    if (Object.prototype.hasOwnProperty.call(data, "companyId")) return row;
    return this.maybeAutoLinkContactCompany(row);
  }

  async updateContact(
    id: string,
    orgId: string,
    data: Partial<typeof clientContacts.$inferInsert>,
  ): Promise<typeof clientContacts.$inferSelect | undefined> {
    const [row] = await db
      .update(clientContacts)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(clientContacts.id, id), eq(clientContacts.orgId, orgId)))
      .returning();
    if (!row) return row;
    // Single-primary invariant (see createContact): promoting one contact to
    // primary demotes the client's other primaries.
    if (data.isPrimary === true && row.clientId) {
      await db
        .update(clientContacts)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(and(
          eq(clientContacts.clientId, row.clientId),
          eq(clientContacts.orgId, orgId),
          ne(clientContacts.id, row.id),
          eq(clientContacts.isPrimary, true),
        ));
    }
    // Task #162: an update may move the contact to a different brand or
    // change deletedAt, both of which affect the per-brand count.
    invalidateBrandStatsCache(orgId);
    // Sprint 2b: SET-ONLY auto-link. No-op if companyId already set or
    // email is free-mail / missing. Never overwrites, never clears.
    // CRITICAL: skip auto-link entirely if the caller's patch included a
    // companyId field (link OR explicit unlink) — otherwise we'd stomp the
    // user's intent within the same request.
    if (Object.prototype.hasOwnProperty.call(data, "companyId")) return row;
    return this.maybeAutoLinkContactCompany(row);
  }

  /**
   * Soft-delete: sets deleted_at = now(). Row remains in DB so foreign-key
   * children (activities, tag assignments, billing references) stay intact.
   */
  async softDeleteContact(
    id: string,
    orgId: string,
  ): Promise<typeof clientContacts.$inferSelect | undefined> {
    const [row] = await db
      .update(clientContacts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(clientContacts.id, id), eq(clientContacts.orgId, orgId)))
      .returning();
    if (row) invalidateBrandStatsCache(orgId);
    return row;
  }

  /**
   * Mass-update a set of contacts in a single transaction.
   * Used by the BulkActionsBar (change stage, mark unsubscribed, etc.).
   */
  async bulkUpdateContacts(
    orgId: string,
    ids: string[],
    patch: Partial<typeof clientContacts.$inferInsert>,
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const n = await db.transaction(async (tx) => {
      const result = await tx
        .update(clientContacts)
        .set({ ...patch, updatedAt: new Date() })
        .where(and(eq(clientContacts.orgId, orgId), inArray(clientContacts.id, ids)))
        .returning({ id: clientContacts.id });
      return result.length;
    });
    if (n > 0) invalidateBrandStatsCache(orgId);
    return n;
  }

  // ── Tags ────────────────────────────────────────────────────────────
  async listTagsByBrand(orgId: string, brandId: string): Promise<ContactTag[]> {
    return db
      .select()
      .from(contactTags)
      .where(and(eq(contactTags.orgId, orgId), eq(contactTags.brandId, brandId)))
      .orderBy(asc(contactTags.name));
  }

  /**
   * Sprint 2d: list tags + per-tag contactCount and lastUsedAt computed on
   * read via a LEFT JOIN to assignments → live contacts. Soft-deleted
   * contacts are excluded from the count (the assignment row still exists
   * per softDeleteContact contract, but the user-visible count should
   * reflect reachable contacts only).
   */
  async listTagsByBrandWithCounts(
    orgId: string,
    brandId: string,
  ): Promise<Array<ContactTag & { contactCount: number; lastUsedAt: Date | null }>> {
    const rows = await db
      .select({
        id:           contactTags.id,
        orgId:        contactTags.orgId,
        brandId:      contactTags.brandId,
        name:         contactTags.name,
        color:        contactTags.color,
        createdAt:    contactTags.createdAt,
        // Sprint 2o.0 (5b1b): retargeted to marketingProspects.
        contactCount: sql<number>`count(distinct case when ${marketingProspects.deletedAt} is null then ${contactTagAssignments.prospectId} end)::int`,
        lastUsedAt:   sql<Date | null>`max(case when ${marketingProspects.deletedAt} is null then ${contactTagAssignments.createdAt} end)`,
      })
      .from(contactTags)
      .leftJoin(contactTagAssignments, eq(contactTagAssignments.tagId, contactTags.id))
      .leftJoin(marketingProspects, eq(marketingProspects.id, contactTagAssignments.prospectId))
      .where(and(eq(contactTags.orgId, orgId), eq(contactTags.brandId, brandId)))
      .groupBy(contactTags.id)
      .orderBy(asc(contactTags.name));
    return rows.map((r) => ({
      ...r,
      lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt as unknown as string) : null,
    }));
  }

  /**
   * Sprint 2d: return the subset of tagIds that do NOT belong to (orgId, brandId).
   * Used by bulk-tag and the contacts list endpoint to reject cross-brand
   * mutations BEFORE any write. Returns [] when every id is valid.
   */
  async findInvalidTagIds(
    orgId: string,
    brandId: string,
    tagIds: string[],
  ): Promise<string[]> {
    if (tagIds.length === 0) return [];
    const rows = await db
      .select({ id: contactTags.id })
      .from(contactTags)
      .where(and(
        eq(contactTags.orgId, orgId),
        eq(contactTags.brandId, brandId),
        inArray(contactTags.id, tagIds),
      ));
    const ok = new Set(rows.map((r) => r.id));
    return tagIds.filter((id) => !ok.has(id));
  }

  /**
   * Sprint 2d: sibling of findInvalidTagIds — for cross-brand contact validation.
   */
  async findInvalidContactIds(
    orgId: string,
    brandId: string,
    contactIds: string[],
  ): Promise<string[]> {
    if (contactIds.length === 0) return [];
    const rows = await db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(and(
        eq(clientContacts.orgId, orgId),
        eq(clientContacts.brandId, brandId),
        inArray(clientContacts.id, contactIds),
      ));
    const ok = new Set(rows.map((r) => r.id));
    return contactIds.filter((id) => !ok.has(id));
  }

  async createTag(data: InsertContactTag): Promise<ContactTag> {
    const [row] = await db.insert(contactTags).values(data).returning();
    return row;
  }

  async deleteTag(id: string, orgId: string): Promise<boolean> {
    const result = await db
      .delete(contactTags)
      .where(and(eq(contactTags.id, id), eq(contactTags.orgId, orgId)))
      .returning({ id: contactTags.id });
    return result.length > 0;
  }

  /** Rename / recolor a tag (tenant-scoped). */
  async updateTag(
    id: string,
    orgId: string,
    patch: { name?: string; color?: string },
  ): Promise<ContactTag | undefined> {
    const [row] = await db
      .update(contactTags)
      .set(patch)
      .where(and(eq(contactTags.id, id), eq(contactTags.orgId, orgId)))
      .returning();
    return row;
  }

  // ── Sprint 2e: Saved segments ───────────────────────────────────────
  /**
   * List all segments for (orgId, brandId) ordered by name.
   */
  async listSegmentsByBrand(
    orgId: string,
    brandId: string,
  ): Promise<ContactSegment[]> {
    return db
      .select()
      .from(contactSegments)
      .where(and(
        eq(contactSegments.orgId, orgId),
        eq(contactSegments.brandId, brandId),
      ))
      .orderBy(asc(contactSegments.name));
  }

  /**
   * Sprint 2e: list segments + per-segment computed `contactCount`. The
   * count is computed by resolving each segment's filter against the
   * contacts table (computed-on-read; no member join table).
   *
   * Known tradeoff (PROOF.md): runs N count queries per page load,
   * acceptable for the expected fleet size (≤ ~50 segments per brand).
   */
  async listSegmentsByBrandWithCounts(
    orgId: string,
    brandId: string,
  ): Promise<Array<ContactSegment & { contactCount: number }>> {
    const segments = await this.listSegmentsByBrand(orgId, brandId);
    if (segments.length === 0) return [];
    const out: Array<ContactSegment & { contactCount: number }> = [];
    for (const s of segments) {
      const filter = (s.filter ?? {}) as { tagIds?: string[]; search?: string };
      const count = await this.countProspectsByFilter(orgId, brandId, {
        tagIds: filter.tagIds ?? [],
        search: filter.search ?? "",
      });
      out.push({ ...s, contactCount: count });
    }
    return out;
  }

  async getSegment(
    id: string,
    orgId: string,
  ): Promise<ContactSegment | undefined> {
    const [row] = await db
      .select()
      .from(contactSegments)
      .where(and(eq(contactSegments.id, id), eq(contactSegments.orgId, orgId)));
    return row;
  }

  async createSegment(data: InsertContactSegment): Promise<ContactSegment> {
    const [row] = await db.insert(contactSegments).values(data).returning();
    return row;
  }

  /**
   * Sprint 2e: only `name` and `filter` are mutable. orgId, brandId, id,
   * createdAt, updatedAt are immutable — the route layer enforces this
   * with a strict picked schema and rejects unknown / forbidden keys
   * with 400 + invalidFields before reaching this method.
   */
  async updateSegment(
    id: string,
    orgId: string,
    patch: { name?: string; filter?: ContactSegmentFilter },
  ): Promise<ContactSegment | undefined> {
    const [row] = await db
      .update(contactSegments)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(contactSegments.id, id), eq(contactSegments.orgId, orgId)))
      .returning();
    return row;
  }

  async deleteSegment(id: string, orgId: string): Promise<boolean> {
    const result = await db
      .delete(contactSegments)
      .where(and(eq(contactSegments.id, id), eq(contactSegments.orgId, orgId)))
      .returning({ id: contactSegments.id });
    return result.length > 0;
  }

  // ── Sprint 2n: Marketing campaigns (single-email drafts) ─────────────
  async listCampaignsByBrand(orgId: string, brandId: string): Promise<MarketingCampaign[]> {
    return db
      .select()
      .from(marketingCampaigns)
      .where(and(eq(marketingCampaigns.orgId, orgId), eq(marketingCampaigns.brandId, brandId)))
      .orderBy(desc(marketingCampaigns.updatedAt));
  }

  async getCampaign(id: string, orgId: string): Promise<MarketingCampaign | undefined> {
    const [row] = await db
      .select()
      .from(marketingCampaigns)
      .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.orgId, orgId)));
    return row;
  }

  async createCampaign(data: InsertMarketingCampaign): Promise<MarketingCampaign> {
    const [row] = await db.insert(marketingCampaigns).values(data).returning();
    return row;
  }

  async updateCampaign(
    id: string,
    orgId: string,
    patch: Partial<Omit<InsertMarketingCampaign, "orgId" | "brandId">>,
  ): Promise<MarketingCampaign | undefined> {
    const [row] = await db
      .update(marketingCampaigns)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.orgId, orgId)))
      .returning();
    return row;
  }

  async deleteCampaign(id: string, orgId: string): Promise<boolean> {
    const result = await db
      .delete(marketingCampaigns)
      .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.orgId, orgId)))
      .returning({ id: marketingCampaigns.id });
    return result.length > 0;
  }

  // ── Sprint 2n: Marketing sequences + steps ───────────────────────────
  async listSequencesByBrand(orgId: string, brandId: string): Promise<MarketingSequence[]> {
    return db
      .select()
      .from(marketingSequences)
      .where(and(eq(marketingSequences.orgId, orgId), eq(marketingSequences.brandId, brandId)))
      .orderBy(desc(marketingSequences.updatedAt));
  }

  async getSequence(id: string, orgId: string): Promise<MarketingSequence | undefined> {
    const [row] = await db
      .select()
      .from(marketingSequences)
      .where(and(eq(marketingSequences.id, id), eq(marketingSequences.orgId, orgId)));
    return row;
  }

  async createSequence(data: InsertMarketingSequence): Promise<MarketingSequence> {
    const [row] = await db.insert(marketingSequences).values(data).returning();
    return row;
  }

  async updateSequence(
    id: string,
    orgId: string,
    patch: Partial<Omit<InsertMarketingSequence, "orgId" | "brandId">>,
  ): Promise<MarketingSequence | undefined> {
    const [row] = await db
      .update(marketingSequences)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(marketingSequences.id, id), eq(marketingSequences.orgId, orgId)))
      .returning();
    return row;
  }

  async deleteSequence(id: string, orgId: string): Promise<boolean> {
    const result = await db
      .delete(marketingSequences)
      .where(and(eq(marketingSequences.id, id), eq(marketingSequences.orgId, orgId)))
      .returning({ id: marketingSequences.id });
    return result.length > 0;
  }

  async listSequenceSteps(sequenceId: string, orgId: string): Promise<MarketingSequenceStep[]> {
    return db
      .select()
      .from(marketingSequenceSteps)
      .where(and(
        eq(marketingSequenceSteps.sequenceId, sequenceId),
        eq(marketingSequenceSteps.orgId, orgId),
      ))
      .orderBy(asc(marketingSequenceSteps.stepOrder));
  }

  async replaceSequenceSteps(
    sequenceId: string,
    orgId: string,
    steps: Array<Omit<InsertMarketingSequenceStep, "sequenceId" | "orgId" | "stepOrder">>,
  ): Promise<MarketingSequenceStep[]> {
    return db.transaction(async (tx) => {
      await tx
        .delete(marketingSequenceSteps)
        .where(and(
          eq(marketingSequenceSteps.sequenceId, sequenceId),
          eq(marketingSequenceSteps.orgId, orgId),
        ));
      if (steps.length === 0) return [];
      const rows = steps.map((s, i) => ({
        ...s,
        sequenceId,
        orgId,
        stepOrder: i,
      }));
      return tx.insert(marketingSequenceSteps).values(rows).returning();
    });
  }

  // ── Task #208 (Sprint 2o.0 re-FK'd to marketing_prospects per HR4) ──
  async listSequenceEnrollments(
    sequenceId: string,
    orgId: string,
  ): Promise<Array<MarketingSequenceEnrollment & {
    contactEmail: string | null;
    contactFirstName: string | null;
    contactLastName: string | null;
  }>> {
    const rows = await db
      .select({
        id: marketingSequenceEnrollments.id,
        orgId: marketingSequenceEnrollments.orgId,
        sequenceId: marketingSequenceEnrollments.sequenceId,
        prospectId: marketingSequenceEnrollments.prospectId,
        currentStepIndex: marketingSequenceEnrollments.currentStepIndex,
        nextSendAt: marketingSequenceEnrollments.nextSendAt,
        status: marketingSequenceEnrollments.status,
        enrolledAt: marketingSequenceEnrollments.enrolledAt,
        updatedAt: marketingSequenceEnrollments.updatedAt,
        contactEmail: marketingProspects.email,
        contactFirstName: marketingProspects.firstName,
        contactLastName: marketingProspects.lastName,
      })
      .from(marketingSequenceEnrollments)
      .leftJoin(
        marketingProspects,
        eq(marketingProspects.id, marketingSequenceEnrollments.prospectId),
      )
      .where(and(
        eq(marketingSequenceEnrollments.sequenceId, sequenceId),
        eq(marketingSequenceEnrollments.orgId, orgId),
      ))
      .orderBy(desc(marketingSequenceEnrollments.enrolledAt));
    return rows;
  }

  /**
   * Enroll a list of contacts into a sequence. Validates each contact
   * belongs to (orgId, brandId) so a planner can't smuggle a contact
   * from another tenant or brand. Existing enrollments (any status) are
   * skipped so re-enrolling is idempotent — `inserted` reflects newly
   * created rows only.
   */
  async enrollProspectsInSequence(
    orgId: string,
    sequenceId: string,
    brandId: string,
    prospectIds: string[],
  ): Promise<{ inserted: number; skipped: number }> {
    if (prospectIds.length === 0) return { inserted: 0, skipped: 0 };
    const uniqueIds = Array.from(new Set(prospectIds));
    return db.transaction(async (tx) => {
      const valid = await tx
        .select({ id: marketingProspects.id })
        .from(marketingProspects)
        .where(and(
          eq(marketingProspects.orgId, orgId),
          eq(marketingProspects.brandId, brandId),
          isNull(marketingProspects.deletedAt),
          inArray(marketingProspects.id, uniqueIds),
        ));
      const validIds = valid.map((p) => p.id);
      if (validIds.length === 0) {
        return { inserted: 0, skipped: uniqueIds.length };
      }
      const existing = await tx
        .select({ prospectId: marketingSequenceEnrollments.prospectId })
        .from(marketingSequenceEnrollments)
        .where(and(
          eq(marketingSequenceEnrollments.sequenceId, sequenceId),
          inArray(marketingSequenceEnrollments.prospectId, validIds),
        ));
      const existingSet = new Set(existing.map((e) => e.prospectId));
      const toInsert = validIds.filter((id) => !existingSet.has(id));
      if (toInsert.length === 0) {
        return { inserted: 0, skipped: uniqueIds.length };
      }
      const now = new Date();
      await tx.insert(marketingSequenceEnrollments).values(
        toInsert.map((prospectId) => ({
          orgId,
          sequenceId,
          prospectId,
          currentStepIndex: 0,
          nextSendAt: now,
          status: "active" as MarketingSequenceEnrollmentStatus,
        })),
      );
      return {
        inserted: toInsert.length,
        skipped: uniqueIds.length - toInsert.length,
      };
    });
  }

  /**
   * @deprecated Sprint 2o.0 — Segment-based enrollment is being migrated to
   * marketing_prospects (segments still target client_contacts via tagIds /
   * search predicates). Until segments are re-pointed at marketing_prospects
   * in Sprint 2o (Campaigns), this is a no-op returning zero counts so the
   * UI doesn't blow up. Use enrollProspectsInSequence with explicit ids.
   */
  async enrollSegmentInSequence(
    _orgId: string,
    _sequenceId: string,
    _segmentId: string,
  ): Promise<{ inserted: number; skipped: number }> {
    return { inserted: 0, skipped: 0 };
  }

  /**
   * Task #293 — Live recipient-count preview for the sequence enrollment
   * dialog. Mirrors campaigns' /audience-preview pattern but adds an
   * "already enrolled" count so the planner can see how many contacts
   * will actually be newly enrolled (idempotent enrollment skips dupes).
   * Computed via SQL join (no N+1 contact fetch).
   */
  /**
   * @deprecated Sprint 2o.0 — see enrollSegmentInSequence above. Returns
   * zero counts until segments are migrated to marketing_prospects.
   */
  async previewSegmentSequenceEnrollment(
    _orgId: string,
    _sequenceId: string,
    _segmentId: string,
  ): Promise<{ totalContacts: number; alreadyEnrolled: number; newContacts: number }> {
    return { totalContacts: 0, alreadyEnrolled: 0, newContacts: 0 };
  }

  async updateSequenceEnrollmentStatus(
    enrollmentId: string,
    orgId: string,
    sequenceId: string,
    status: MarketingSequenceEnrollmentStatus,
  ): Promise<MarketingSequenceEnrollment | undefined> {
    const [row] = await db
      .update(marketingSequenceEnrollments)
      .set({ status, updatedAt: new Date() })
      .where(and(
        eq(marketingSequenceEnrollments.id, enrollmentId),
        eq(marketingSequenceEnrollments.orgId, orgId),
        eq(marketingSequenceEnrollments.sequenceId, sequenceId),
      ))
      .returning();
    return row;
  }

  async deleteSequenceEnrollment(
    enrollmentId: string,
    orgId: string,
    sequenceId: string,
  ): Promise<boolean> {
    const result = await db
      .delete(marketingSequenceEnrollments)
      .where(and(
        eq(marketingSequenceEnrollments.id, enrollmentId),
        eq(marketingSequenceEnrollments.orgId, orgId),
        eq(marketingSequenceEnrollments.sequenceId, sequenceId),
      ))
      .returning({ id: marketingSequenceEnrollments.id });
    return result.length > 0;
  }

  // ── Task #235: Per-recipient send failures (campaigns + sequences) ──
  /**
   * Latest send attempt per recipient for a given campaign. Returns
   * recipients whose terminal state is `failed` (still scheduled for
   * retry) or `permanent_failure` (we gave up). Successful recipients
   * are excluded — admins only need to see who did NOT get the email.
   */
  async listCampaignFailedRecipients(
    orgId: string,
    campaignId: string,
  ): Promise<Array<{
    contactId: string | null;
    recipientEmail: string | null;
    contactFirstName: string | null;
    contactLastName: string | null;
    attemptNumber: number;
    status: "failed" | "permanent_failure";
    errorCode: string | null;
    errorMessage: string | null;
    attemptedAt: Date;
    nextRetryAt: Date | null;
  }>> {
    // HR4-FIX-5b1c.1: retargeted to prospect_id / marketing_prospects.
    // email_send_attempts.contact_id was dropped by migration 0019; the
    // FK is now prospect_id → marketing_prospects.
    const rows = await db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (prospect_id)
               prospect_id, recipient_email, attempt_number, status, error_code,
               error_message, attempted_at, next_retry_at
        FROM email_send_attempts
        WHERE org_id = ${orgId}
          AND kind = 'campaign'
          AND campaign_id = ${campaignId}
        ORDER BY prospect_id, attempted_at DESC
      )
      SELECT l.prospect_id, l.recipient_email, l.attempt_number, l.status,
             l.error_code, l.error_message, l.attempted_at, l.next_retry_at,
             c.first_name AS contact_first_name,
             c.last_name AS contact_last_name
      FROM latest l
      LEFT JOIN marketing_prospects c ON c.id = l.prospect_id
      WHERE l.status IN ('failed', 'permanent_failure')
      ORDER BY l.attempted_at DESC
    `);
    const data = (rows as { rows?: Array<Record<string, unknown>> }).rows
      ?? (rows as unknown as Array<Record<string, unknown>>);
    return (data ?? []).map((r) => ({
      contactId: (r.prospect_id as string | null) ?? null,
      recipientEmail: (r.recipient_email as string | null) ?? null,
      contactFirstName: (r.contact_first_name as string | null) ?? null,
      contactLastName: (r.contact_last_name as string | null) ?? null,
      attemptNumber: Number(r.attempt_number ?? 1),
      status: r.status as "failed" | "permanent_failure",
      errorCode: (r.error_code as string | null) ?? null,
      errorMessage: (r.error_message as string | null) ?? null,
      attemptedAt: r.attempted_at instanceof Date
        ? r.attempted_at
        : new Date(r.attempted_at as string),
      nextRetryAt: r.next_retry_at
        ? (r.next_retry_at instanceof Date
          ? r.next_retry_at
          : new Date(r.next_retry_at as string))
        : null,
    }));
  }

  /**
   * Per-campaign delivery metrics aggregated from email_send_attempts.
   * Returns counts by terminal status plus distinct recipient count.
   */
  async getCampaignSendMetrics(
    orgId: string,
    campaignId: string,
  ): Promise<{
    sent: number;
    failed: number;
    permanentFailure: number;
    totalAttempts: number;
    distinctRecipients: number;
  }> {
    const rows = await db.execute(sql`
      SELECT status, COUNT(*)::int AS n,
             COUNT(DISTINCT recipient_email)::int AS distinct_n
      FROM email_send_attempts
      WHERE org_id = ${orgId}
        AND kind = 'campaign'
        AND campaign_id = ${campaignId}
      GROUP BY status
    `);
    const data = (rows as { rows?: Array<Record<string, unknown>> }).rows
      ?? (rows as unknown as Array<Record<string, unknown>>);
    let sent = 0, failed = 0, permanentFailure = 0, totalAttempts = 0;
    for (const r of (data ?? [])) {
      const n = Number(r.n ?? 0);
      totalAttempts += n;
      if (r.status === "success") sent += n;
      else if (r.status === "failed") failed += n;
      else if (r.status === "permanent_failure") permanentFailure += n;
    }
    const distRows = await db.execute(sql`
      SELECT COUNT(DISTINCT recipient_email)::int AS n
      FROM email_send_attempts
      WHERE org_id = ${orgId}
        AND kind = 'campaign'
        AND campaign_id = ${campaignId}
    `);
    const distData = (distRows as { rows?: Array<Record<string, unknown>> }).rows
      ?? (distRows as unknown as Array<Record<string, unknown>>);
    const distinctRecipients = Number((distData?.[0]?.n) ?? 0);
    return { sent, failed, permanentFailure, totalAttempts, distinctRecipients };
  }

  // ── Sprint 2p: immediate-dispatch "Send Now" helpers ─────────────────
  // These two methods support POST /api/marketing/campaigns/:id/send-now
  // which dispatches a campaign synchronously via Resend.

  /** Insert a single per-recipient terminal send attempt. */
  async recordCampaignSendAttempt(input: {
    orgId: string;
    campaignId: string;
    prospectId: string | null;
    recipientEmail: string;
    status: EmailSendAttemptStatus;
    providerMessageId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<void> {
    await db.insert(emailSendAttempts).values({
      orgId: input.orgId,
      kind: "campaign",
      campaignId: input.campaignId,
      prospectId: input.prospectId,
      recipientEmail: input.recipientEmail,
      attemptNumber: 1,
      status: input.status,
      transport: "resend",
      providerMessageId: input.providerMessageId ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
    });
  }

  /**
   * Stamp a campaign as sent. Sets sent_at = NOW(); also stamps send_at
   * to the same instant if it was null so the row reflects the actual
   * dispatch time on the listing page.
   */
  async markCampaignSent(
    id: string,
    orgId: string,
  ): Promise<MarketingCampaign | undefined> {
    const now = new Date();
    const [row] = await db
      .update(marketingCampaigns)
      .set({ sentAt: now, sendAt: now, updatedAt: now })
      .where(and(eq(marketingCampaigns.id, id), eq(marketingCampaigns.orgId, orgId)))
      .returning();
    return row;
  }

  /**
   * Latest send attempt per (recipient, step_index) for a sequence.
   * Returns failures and permanent failures grouped by step so an admin
   * can see exactly which contacts dropped out at which step.
   */
  async listSequenceFailedRecipients(
    orgId: string,
    sequenceId: string,
    stepIndex?: number,
  ): Promise<Array<{
    contactId: string | null;
    recipientEmail: string | null;
    contactFirstName: string | null;
    contactLastName: string | null;
    stepIndex: number | null;
    attemptNumber: number;
    status: "failed" | "permanent_failure";
    errorCode: string | null;
    errorMessage: string | null;
    attemptedAt: Date;
    nextRetryAt: Date | null;
  }>> {
    const stepFilter = stepIndex === undefined
      ? sql``
      : sql` AND step_index = ${stepIndex}`;
    // HR4-FIX-5b1c.1: retargeted to prospect_id / marketing_prospects.
    // email_send_attempts.contact_id was dropped by migration 0019; the
    // FK is now prospect_id → marketing_prospects.
    const rows = await db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (prospect_id, step_index)
               prospect_id, recipient_email, step_index, attempt_number, status,
               error_code, error_message, attempted_at, next_retry_at
        FROM email_send_attempts
        WHERE org_id = ${orgId}
          AND kind = 'sequence'
          AND sequence_id = ${sequenceId}${stepFilter}
        ORDER BY prospect_id, step_index, attempted_at DESC
      )
      SELECT l.prospect_id, l.recipient_email, l.step_index, l.attempt_number,
             l.status, l.error_code, l.error_message, l.attempted_at, l.next_retry_at,
             c.first_name AS contact_first_name,
             c.last_name AS contact_last_name
      FROM latest l
      LEFT JOIN marketing_prospects c ON c.id = l.prospect_id
      WHERE l.status IN ('failed', 'permanent_failure')
      ORDER BY l.step_index ASC, l.attempted_at DESC
    `);
    const data = (rows as { rows?: Array<Record<string, unknown>> }).rows
      ?? (rows as unknown as Array<Record<string, unknown>>);
    return (data ?? []).map((r) => ({
      contactId: (r.prospect_id as string | null) ?? null,
      recipientEmail: (r.recipient_email as string | null) ?? null,
      contactFirstName: (r.contact_first_name as string | null) ?? null,
      contactLastName: (r.contact_last_name as string | null) ?? null,
      stepIndex: r.step_index === null || r.step_index === undefined
        ? null
        : Number(r.step_index),
      attemptNumber: Number(r.attempt_number ?? 1),
      status: r.status as "failed" | "permanent_failure",
      errorCode: (r.error_code as string | null) ?? null,
      errorMessage: (r.error_message as string | null) ?? null,
      attemptedAt: r.attempted_at instanceof Date
        ? r.attempted_at
        : new Date(r.attempted_at as string),
      nextRetryAt: r.next_retry_at
        ? (r.next_retry_at instanceof Date
          ? r.next_retry_at
          : new Date(r.next_retry_at as string))
        : null,
    }));
  }

  /**
   * Sprint 2e: count contacts matching a segment filter without paying
   * the cost of fetching rows + tag joins. Mirrors the predicates in
   * listContactsByOrg (orgId, brandId, deletedAt IS NULL, tagIds AND-
   * intersection, search ilike across name/email/company/title).
   */
  // Sprint 2o.0 (5b1c.1): countContactsByFilter → countProspectsByFilter.
  // Case 1 MARKETING-ONLY rename + retarget to marketingProspects.
  async countProspectsByFilter(
    orgId: string,
    brandId: string,
    filter: { tagIds: string[]; search: string },
  ): Promise<number> {
    const wheres: SQL[] = [
      eq(marketingProspects.orgId, orgId),
      eq(marketingProspects.brandId, brandId),
      isNull(marketingProspects.deletedAt),
    ];
    if (filter.search && filter.search.trim()) {
      const s = `%${filter.search.trim()}%`;
      wheres.push(
        or(
          ilike(marketingProspects.firstName, s),
          ilike(marketingProspects.lastName, s),
          ilike(marketingProspects.email, s),
          ilike(marketingProspects.title, s),
        )!,
      );
    }
    if (filter.tagIds.length > 0) {
      const sub = db
        .select({ prospectId: contactTagAssignments.prospectId })
        .from(contactTagAssignments)
        .where(inArray(contactTagAssignments.tagId, filter.tagIds))
        .groupBy(contactTagAssignments.prospectId)
        .having(sql`count(distinct ${contactTagAssignments.tagId}) = ${filter.tagIds.length}`);
      wheres.push(inArray(marketingProspects.id, sub));
    }
    const [row] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(marketingProspects)
      .where(and(...wheres));
    return row?.c ?? 0;
  }

  /**
   * Sprint 2e: resolve a segment's filter to its current member prospects
   * (computed on read). Honours the same predicates as listProspectsByFilter.
   * Returns rows enriched with `tags` for parity with the prospects list
   * endpoint so the UI can re-use existing rendering.
   *
   * Sprint 2o.0 (5b1c.1): resolveSegmentContacts → resolveSegmentProspects.
   * Case 1 MARKETING-ONLY rename; delegates to listProspectsByFilter which
   * now reads from marketingProspects.
   */
  async resolveSegmentProspects(
    orgId: string,
    brandId: string,
    filter: { tagIds: string[]; search: string },
    pagination: { limit?: number; offset?: number } = {},
  ): Promise<Array<MarketingProspect & { tags: ContactTag[] }>> {
    return this.listProspectsByFilter(
      orgId,
      brandId,
      { tagIds: filter.tagIds, search: filter.search, deleted: "exclude" },
      pagination,
    );
  }

  /**
   * Remove a single tag assignment from a contact (tenant-scoped).
   * Returns true if a row was deleted, false if no such assignment existed
   * or either side belongs to a different org.
   */
  async removeTagFromContact(
    orgId: string,
    prospectId: string,
    tagId: string,
    opts: { actorId?: string | null } = {},
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      // Sprint 2o.0 (5b1b): retargeted to marketingProspects.
      const [prospect] = await tx
        .select({ id: marketingProspects.id, brandId: marketingProspects.brandId })
        .from(marketingProspects)
        .where(and(eq(marketingProspects.id, prospectId), eq(marketingProspects.orgId, orgId)));
      if (!prospect) throw new Error("Contact not found");

      const [tag] = await tx
        .select({ id: contactTags.id, name: contactTags.name })
        .from(contactTags)
        .where(and(eq(contactTags.id, tagId), eq(contactTags.orgId, orgId)));
      if (!tag) return false;

      const result = await tx
        .delete(contactTagAssignments)
        .where(and(
          eq(contactTagAssignments.prospectId, prospectId),
          eq(contactTagAssignments.tagId, tagId),
        ))
        .returning({ prospectId: contactTagAssignments.prospectId });

      if (result.length > 0) {
        await tx.insert(contactActivities).values({
          orgId,
          brandId: prospect.brandId ?? null,
          prospectId,
          type: "tag_removed",
          payload: { tag_id: tag.id, tag_name: tag.name },
          actorId: opts.actorId ?? null,
        });
      }
      return result.length > 0;
    });
  }

  /**
   * Replace a contact's full tag set in one transaction.
   * Validates all tagIds belong to the same org as the contact.
   */
  async setContactTags(
    orgId: string,
    prospectId: string,
    tagIds: string[],
  ): Promise<ContactTag[]> {
    return db.transaction(async (tx) => {
      // Sprint 2o.0 (5b1b): retargeted to marketingProspects.
      const [prospect] = await tx
        .select({ id: marketingProspects.id })
        .from(marketingProspects)
        .where(and(eq(marketingProspects.id, prospectId), eq(marketingProspects.orgId, orgId)));
      if (!prospect) throw new Error("Contact not found");

      if (tagIds.length > 0) {
        const okTags = await tx
          .select({ id: contactTags.id })
          .from(contactTags)
          .where(and(eq(contactTags.orgId, orgId), inArray(contactTags.id, tagIds)));
        if (okTags.length !== tagIds.length) throw new Error("Invalid tag id(s)");
      }

      await tx.delete(contactTagAssignments).where(eq(contactTagAssignments.prospectId, prospectId));
      if (tagIds.length > 0) {
        await tx
          .insert(contactTagAssignments)
          .values(tagIds.map((tagId) => ({ prospectId, tagId })));
      }

      const result = await tx
        .select({ tag: contactTags })
        .from(contactTagAssignments)
        .innerJoin(contactTags, eq(contactTags.id, contactTagAssignments.tagId))
        .where(eq(contactTagAssignments.prospectId, prospectId));
      return result.map((r) => r.tag);
    });
  }

  /**
   * Bulk-attach a set of tags to many contacts in one transaction. Existing
   * (contactId, tagId) assignments are left untouched (idempotent — safe to
   * call from re-runnable flows like CSV import where some rows are
   * "updated" rather than "created").
   *
   * Validates that every tagId belongs to (orgId, brandId) and every
   * contactId belongs to (orgId, brandId). Returns the number of *distinct
   * contacts* that received at least one tag (i.e. the input contactIds
   * filtered down to those that survived the org/brand check).
   */
  async addTagsToContacts(
    orgId: string,
    brandId: string,
    prospectIds: string[],
    tagIds: string[],
  ): Promise<number> {
    if (prospectIds.length === 0 || tagIds.length === 0) return 0;
    return db.transaction(async (tx) => {
      const okTags = await tx
        .select({ id: contactTags.id })
        .from(contactTags)
        .where(and(
          eq(contactTags.orgId, orgId),
          eq(contactTags.brandId, brandId),
          inArray(contactTags.id, tagIds),
        ));
      if (okTags.length !== tagIds.length) {
        throw new Error("Invalid tag id(s)");
      }
      // Sprint 2o.0 (5b1b): retargeted to marketingProspects.
      const okProspects = await tx
        .select({ id: marketingProspects.id })
        .from(marketingProspects)
        .where(and(
          eq(marketingProspects.orgId, orgId),
          eq(marketingProspects.brandId, brandId),
          inArray(marketingProspects.id, prospectIds),
        ));
      if (okProspects.length === 0) return 0;
      const values: Array<{ prospectId: string; tagId: string }> = [];
      for (const p of okProspects) {
        for (const t of okTags) {
          values.push({ prospectId: p.id, tagId: t.id });
        }
      }
      await tx.insert(contactTagAssignments).values(values).onConflictDoNothing();
      return okProspects.length;
    });
  }


  /**
   * Sprint 2d: derive a single brandId from a list of
   * contactIds, all scoped to (orgId). Returns ok=false (with reason +
   * invalidContactIds) when:
   *   - any contactId is missing/foreign-org
   *   - any contact has no brandId
   *   - the contacts span more than one brand
   * Used by /bulk-tag when the caller omits `brandId` from the body.
   */
  async deriveBrandIdForContacts(
    orgId: string,
    contactIds: string[],
  ): Promise<
    | { ok: true; brandId: string }
    | { ok: false; reason: string; invalidContactIds: string[] }
  > {
    if (contactIds.length === 0) {
      return { ok: false, reason: "contactIds is empty", invalidContactIds: [] };
    }
    const rows = await db
      .select({ id: clientContacts.id, brandId: clientContacts.brandId })
      .from(clientContacts)
      .where(and(
        eq(clientContacts.orgId, orgId),
        inArray(clientContacts.id, contactIds),
      ));
    const foundIds = new Set(rows.map((r) => r.id));
    const missing = contactIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return { ok: false, reason: "Unknown or cross-org contact id(s)", invalidContactIds: missing };
    }
    const brands = new Set(rows.map((r) => r.brandId).filter((b): b is string => !!b));
    const noBrand = rows.filter((r) => !r.brandId).map((r) => r.id);
    if (noBrand.length > 0) {
      return { ok: false, reason: "One or more contacts have no brand", invalidContactIds: noBrand };
    }
    if (brands.size !== 1) {
      return { ok: false, reason: "Contacts span multiple brands; pass brandId explicitly", invalidContactIds: [] };
    }
    return { ok: true, brandId: brands.values().next().value as string };
  }

  // ── Sprint 2o.0 (5b1b): Prospect-side parity helpers ───────────────────
  // Mirror of getContact + tag join / findInvalidContactIds /
  // deriveBrandIdForContacts for the marketing surface, which now backs
  // against marketing_prospects instead of client_contacts. The
  // contact-side helpers above remain in place for legitimate PSO callers
  // (client-routes.ts). getProspect/createProspect/updateProspect are
  // declared further down in the Marketing Prospects section.
  async getProspectWithTags(
    id: string,
    orgId: string,
  ): Promise<(typeof marketingProspects.$inferSelect & { tags: ContactTag[] }) | undefined> {
    const [row] = await db
      .select()
      .from(marketingProspects)
      .where(and(eq(marketingProspects.id, id), eq(marketingProspects.orgId, orgId)));
    if (!row) return undefined;
    const tagRows = await db
      .select({ tag: contactTags })
      .from(contactTagAssignments)
      .innerJoin(contactTags, eq(contactTags.id, contactTagAssignments.tagId))
      .where(and(
        eq(contactTagAssignments.prospectId, id),
        eq(contactTags.orgId, orgId),
      ));
    return { ...row, tags: tagRows.map((r) => r.tag) };
  }

  async findInvalidProspectIds(
    orgId: string,
    brandId: string,
    prospectIds: string[],
  ): Promise<string[]> {
    if (prospectIds.length === 0) return [];
    const rows = await db
      .select({ id: marketingProspects.id })
      .from(marketingProspects)
      .where(and(
        eq(marketingProspects.orgId, orgId),
        eq(marketingProspects.brandId, brandId),
        inArray(marketingProspects.id, prospectIds),
        isNull(marketingProspects.deletedAt),
      ));
    const ok = new Set(rows.map((r) => r.id));
    return prospectIds.filter((id) => !ok.has(id));
  }

  async deriveBrandIdForProspects(
    orgId: string,
    prospectIds: string[],
  ): Promise<
    | { ok: true; brandId: string }
    | { ok: false; reason: string; invalidContactIds: string[] }
  > {
    if (prospectIds.length === 0) {
      return { ok: false, reason: "contactIds is empty", invalidContactIds: [] };
    }
    const rows = await db
      .select({ id: marketingProspects.id, brandId: marketingProspects.brandId })
      .from(marketingProspects)
      .where(and(
        eq(marketingProspects.orgId, orgId),
        inArray(marketingProspects.id, prospectIds),
      ));
    const foundIds = new Set(rows.map((r) => r.id));
    const missing = prospectIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return { ok: false, reason: "Unknown or cross-org contact id(s)", invalidContactIds: missing };
    }
    const brands = new Set(rows.map((r) => r.brandId).filter((b): b is string => !!b));
    const noBrand = rows.filter((r) => !r.brandId).map((r) => r.id);
    if (noBrand.length > 0) {
      return { ok: false, reason: "One or more contacts have no brand", invalidContactIds: noBrand };
    }
    if (brands.size !== 1) {
      return { ok: false, reason: "Contacts span multiple brands; pass brandId explicitly", invalidContactIds: [] };
    }
    return { ok: true, brandId: brands.values().next().value as string };
  }

  /**
   * Sprint 2d: atomic bulk assign. ONE transaction does
   * validation → pre-count → insert (ON CONFLICT DO NOTHING) → post-count
   * so the returned `assigned`/`skipped` are exact even under concurrency.
   * Throws "Invalid tag id(s)" / "Invalid contact id(s)" before any write
   * so the route can return 400 with zero rows mutated.
   */
  async bulkAssignTagsAtomic(
    orgId: string,
    brandId: string,
    prospectIds: string[],
    tagIds: string[],
    opts: { actorId?: string | null } = {},
  ): Promise<{ assigned: number; skipped: number; contactsTouched: number }> {
    if (prospectIds.length === 0 || tagIds.length === 0) {
      return { assigned: 0, skipped: 0, contactsTouched: 0 };
    }
    return db.transaction(async (tx) => {
      const okTags = await tx
        .select({ id: contactTags.id, name: contactTags.name })
        .from(contactTags)
        .where(and(
          eq(contactTags.orgId, orgId),
          eq(contactTags.brandId, brandId),
          inArray(contactTags.id, tagIds),
        ));
      if (okTags.length !== tagIds.length) throw new Error("Invalid tag id(s)");
      // Sprint 2o.0 (5b1b): retargeted to marketingProspects.
      const okProspects = await tx
        .select({ id: marketingProspects.id })
        .from(marketingProspects)
        .where(and(
          eq(marketingProspects.orgId, orgId),
          eq(marketingProspects.brandId, brandId),
          inArray(marketingProspects.id, prospectIds),
        ));
      if (okProspects.length !== prospectIds.length) throw new Error("Invalid contact id(s)");

      const okProspectIds = okProspects.map((p) => p.id);
      const okTagIds = okTags.map((t) => t.id);
      const totalPairs = okProspectIds.length * okTagIds.length;

      const values: Array<{ prospectId: string; tagId: string }> = [];
      for (const p of okProspectIds) for (const t of okTagIds) values.push({ prospectId: p, tagId: t });
      const inserted = await tx
        .insert(contactTagAssignments)
        .values(values)
        .onConflictDoNothing()
        .returning({
          prospectId: contactTagAssignments.prospectId,
          tagId: contactTagAssignments.tagId,
        });

      if (inserted.length > 0) {
        const tagNameById = new Map(okTags.map((t) => [t.id, t.name]));
        const activityRows = inserted.map((r) => ({
          orgId,
          brandId,
          prospectId: r.prospectId,
          type: "tag_added" as const,
          payload: { tag_id: r.tagId, tag_name: tagNameById.get(r.tagId) ?? "" },
          actorId: opts.actorId ?? null,
        }));
        await tx.insert(contactActivities).values(activityRows);
      }

      const assigned = inserted.length;
      return {
        assigned,
        skipped: totalPairs - assigned,
        contactsTouched: new Set(inserted.map((r) => r.prospectId)).size,
      };
    });
  }

  /**
   * Sprint 2d: atomic single-add. Returns assigned=1 only
   * when a NEW (contact, tag) row was inserted; assigned=0 if it already
   * existed (true idempotent semantics).
   */
  async addSingleTagToContactAtomic(
    orgId: string,
    prospectId: string,
    tagId: string,
    opts: { actorId?: string | null } = {},
  ): Promise<{ assigned: 0 | 1 }> {
    return db.transaction(async (tx) => {
      // Sprint 2o.0 (5b1b): retargeted to marketingProspects.
      const [prospect] = await tx
        .select({ id: marketingProspects.id, brandId: marketingProspects.brandId })
        .from(marketingProspects)
        .where(and(eq(marketingProspects.id, prospectId), eq(marketingProspects.orgId, orgId)));
      if (!prospect) throw new Error("Contact not found");
      if (!prospect.brandId) throw new Error("Contact is not assigned to a brand");
      const [tag] = await tx
        .select({ id: contactTags.id, name: contactTags.name })
        .from(contactTags)
        .where(and(
          eq(contactTags.id, tagId),
          eq(contactTags.orgId, orgId),
          eq(contactTags.brandId, prospect.brandId),
        ));
      if (!tag) throw new Error("Invalid tag id");
      const inserted = await tx
        .insert(contactTagAssignments)
        .values([{ prospectId, tagId }])
        .onConflictDoNothing()
        .returning({ prospectId: contactTagAssignments.prospectId });
      if (inserted.length > 0) {
        await tx.insert(contactActivities).values({
          orgId,
          brandId: prospect.brandId,
          prospectId,
          type: "tag_added",
          payload: { tag_id: tag.id, tag_name: tag.name },
          actorId: opts.actorId ?? null,
        });
      }
      return { assigned: inserted.length > 0 ? 1 : 0 };
    });
  }

  /**
   * Sprint 2d: atomic bulk unassign. Validates+deletes in ONE
   * transaction; returns exact (unassigned, skipped).
   */
  async bulkUnassignTagsAtomic(
    orgId: string,
    brandId: string,
    prospectIds: string[],
    tagIds: string[],
    opts: { actorId?: string | null } = {},
  ): Promise<{ unassigned: number; skipped: number }> {
    if (prospectIds.length === 0 || tagIds.length === 0) {
      return { unassigned: 0, skipped: 0 };
    }
    return db.transaction(async (tx) => {
      const okTags = await tx
        .select({ id: contactTags.id, name: contactTags.name })
        .from(contactTags)
        .where(and(
          eq(contactTags.orgId, orgId),
          eq(contactTags.brandId, brandId),
          inArray(contactTags.id, tagIds),
        ));
      if (okTags.length !== tagIds.length) throw new Error("Invalid tag id(s)");
      // Sprint 2o.0 (5b1b): retargeted to marketingProspects.
      const okProspects = await tx
        .select({ id: marketingProspects.id })
        .from(marketingProspects)
        .where(and(
          eq(marketingProspects.orgId, orgId),
          eq(marketingProspects.brandId, brandId),
          inArray(marketingProspects.id, prospectIds),
        ));
      if (okProspects.length !== prospectIds.length) throw new Error("Invalid contact id(s)");
      const totalPairs = okProspects.length * okTags.length;
      const result = await tx
        .delete(contactTagAssignments)
        .where(and(
          inArray(contactTagAssignments.prospectId, okProspects.map((p) => p.id)),
          inArray(contactTagAssignments.tagId, okTags.map((t) => t.id)),
        ))
        .returning({
          prospectId: contactTagAssignments.prospectId,
          tagId: contactTagAssignments.tagId,
        });

      if (result.length > 0) {
        const tagNameById = new Map(okTags.map((t) => [t.id, t.name]));
        const activityRows = result.map((r) => ({
          orgId,
          brandId,
          prospectId: r.prospectId,
          type: "tag_removed" as const,
          payload: { tag_id: r.tagId, tag_name: tagNameById.get(r.tagId) ?? "" },
          actorId: opts.actorId ?? null,
        }));
        await tx.insert(contactActivities).values(activityRows);
      }

      return { unassigned: result.length, skipped: totalPairs - result.length };
    });
  }

  /**
   * Sprint 2d: bulk-DETACH a set of tags from many contacts in one
   * transaction. Mirrors `addTagsToContacts` validation: every contactId
   * AND every tagId must belong to (orgId, brandId). Missing assignments
   * are no-ops (idempotent). Returns the number of (contactId, tagId)
   * rows actually deleted.
   */
  async removeTagsFromContacts(
    orgId: string,
    brandId: string,
    prospectIds: string[],
    tagIds: string[],
  ): Promise<number> {
    if (prospectIds.length === 0 || tagIds.length === 0) return 0;
    return db.transaction(async (tx) => {
      const okTags = await tx
        .select({ id: contactTags.id })
        .from(contactTags)
        .where(and(
          eq(contactTags.orgId, orgId),
          eq(contactTags.brandId, brandId),
          inArray(contactTags.id, tagIds),
        ));
      if (okTags.length !== tagIds.length) {
        throw new Error("Invalid tag id(s)");
      }
      // Sprint 2o.0 (5b1b): retargeted to marketingProspects.
      const okProspects = await tx
        .select({ id: marketingProspects.id })
        .from(marketingProspects)
        .where(and(
          eq(marketingProspects.orgId, orgId),
          eq(marketingProspects.brandId, brandId),
          inArray(marketingProspects.id, prospectIds),
        ));
      if (okProspects.length === 0) return 0;
      const okProspectIds = okProspects.map((p) => p.id);
      const okTagIds = okTags.map((t) => t.id);
      const result = await tx
        .delete(contactTagAssignments)
        .where(and(
          inArray(contactTagAssignments.prospectId, okProspectIds),
          inArray(contactTagAssignments.tagId, okTagIds),
        ))
        .returning({ prospectId: contactTagAssignments.prospectId });
      return result.length;
    });
  }

  // ── Activities ──────────────────────────────────────────────────────
  async listContactActivities(
    orgId: string,
    contactId: string,
    limit: number = 100,
  ): Promise<ContactActivity[]> {
    // Sprint 2f: delegate to the typed helper. Order is occurred_at desc.
    return this.listActivitiesByContact(orgId, contactId, { limit });
  }

  /**
   * Sprint 2f — Per-contact timeline reader. Verifies the contact belongs
   * to the org, then filters activities by org+contact. Sorts by
   * occurred_at desc then created_at desc (tiebreaker for backdated rows).
   * Optional `types` filter narrows to a subset.
   */
  async listActivitiesByContact(
    orgId: string,
    prospectId: string,
    opts: { types?: string[]; limit?: number; offset?: number } = {},
  ): Promise<ContactActivity[]> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    // Sprint 2o.0 (5b1b): retargeted to marketingProspects.
    const [prospect] = await db
      .select({ id: marketingProspects.id })
      .from(marketingProspects)
      .where(and(eq(marketingProspects.id, prospectId), eq(marketingProspects.orgId, orgId)));
    if (!prospect) return [];
    const wheres: SQL[] = [
      eq(contactActivities.prospectId, prospectId),
      eq(contactActivities.orgId, orgId),
    ];
    if (opts.types && opts.types.length > 0) {
      wheres.push(inArray(contactActivities.type, opts.types));
    }
    return db
      .select()
      .from(contactActivities)
      .where(and(...wheres))
      .orderBy(desc(contactActivities.occurredAt), desc(contactActivities.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Sprint 2f — Firehose reader. brandId REQUIRED (R6). Optional filters:
   * types, contactId, from, to. Sorts occurred_at desc.
   * Date-range cap (365 days) is enforced at the route boundary, NOT here.
   */
  async listActivities(
    orgId: string,
    brandId: string,
    opts: {
      types?: string[];
      contactId?: string;
      from?: Date;
      to?: Date;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Array<ContactActivity & { contactName: string | null; actorName: string | null }>> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);

    const wheres: SQL[] = [
      eq(contactActivities.orgId, orgId),
      eq(contactActivities.brandId, brandId),
    ];
    if (opts.types && opts.types.length > 0) {
      wheres.push(inArray(contactActivities.type, opts.types));
    }
    // Sprint 2o.0 (5b1b): contactId param is interpreted as prospectId.
    if (opts.contactId) wheres.push(eq(contactActivities.prospectId, opts.contactId));
    if (opts.from) wheres.push(gte(contactActivities.occurredAt, opts.from));
    if (opts.to)   wheres.push(lte(contactActivities.occurredAt, opts.to));

    const rows = await db
      .select({
        a: contactActivities,
        firstName: marketingProspects.firstName,
        lastName: marketingProspects.lastName,
        actorName: users.name,
      })
      .from(contactActivities)
      .innerJoin(marketingProspects, eq(marketingProspects.id, contactActivities.prospectId))
      .leftJoin(users, eq(users.id, contactActivities.actorId))
      .where(and(...wheres))
      .orderBy(desc(contactActivities.occurredAt), desc(contactActivities.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({
      ...r.a,
      contactName: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
      actorName: r.actorName ?? null,
    }));
  }

  /**
   * Sprint 2f — Single-row activity insert. Accepts an optional Drizzle
   * transaction client so emission callers can splice it into the parent
   * write's tx. When `tx` is omitted, runs in its own transaction.
   * Verifies contact ownership and bumps `last_activity_at` on the parent
   * contact in the same tx so list ordering stays accurate.
   */
  async createActivity(
    data: InsertContactActivity,
    opts: { tx?: typeof db } = {},
  ): Promise<ContactActivity> {
    const run = async (exec: typeof db) => {
      // Sprint 2o.0 (5b1b): retargeted to marketingProspects. The activity row
      // is keyed by prospectId; the legacy contactId column is left null.
      const prospectId = data.prospectId;
      if (!prospectId) {
        throw new Error("createActivity requires prospectId");
      }
      const [owner] = await exec
        .select({ id: marketingProspects.id })
        .from(marketingProspects)
        .where(and(eq(marketingProspects.id, prospectId), eq(marketingProspects.orgId, data.orgId)));
      if (!owner) {
        throw new Error("Contact not found");
      }
      const [row] = await exec.insert(contactActivities).values(data).returning();
      await exec
        .update(marketingProspects)
        .set({ lastActivityAt: row.occurredAt, updatedAt: new Date() })
        .where(and(
          eq(marketingProspects.id, prospectId),
          eq(marketingProspects.orgId, data.orgId),
        ));
      return row;
    };
    const inserted = opts.tx
      ? await run(opts.tx)
      : await db.transaction((t) => run(t as unknown as typeof db));
    // Task #162: only "sent" activities feed lastSentAt in the brand list.
    if (ACTIVITY_TYPES_AFFECTING_LAST_SENT.has(inserted.type)) {
      invalidateBrandStatsCache(inserted.orgId);
    }
    return inserted;
  }

  /**
   * Sprint 2f — Bulk activity insert (R4). One single Drizzle INSERT with
   * a values array, capped at 1000 rows defensively (route enforces the
   * cap before reaching here). Bumps `last_activity_at` on every distinct
   * contact in one UPDATE. Accepts an optional tx for parent-tx splice.
   */
  async createActivitiesBatch(
    rows: InsertContactActivity[],
    opts: { tx?: typeof db } = {},
  ): Promise<ContactActivity[]> {
    if (rows.length === 0) return [];
    if (rows.length > 1000) {
      throw new Error("createActivitiesBatch exceeds 1000-row cap");
    }
    const run = async (exec: typeof db) => {
      const inserted = await exec.insert(contactActivities).values(rows).returning();
      // Sprint 2o.0 (5b1b): bump last_activity_at per distinct prospect.
      const byProspect = new Map<string, { orgId: string; max: Date }>();
      for (const r of inserted) {
        if (!r.prospectId) continue;
        const cur = byProspect.get(r.prospectId);
        if (!cur || r.occurredAt > cur.max) {
          byProspect.set(r.prospectId, { orgId: r.orgId, max: r.occurredAt });
        }
      }
      for (const [prospectId, { orgId, max }] of Array.from(byProspect)) {
        await exec
          .update(marketingProspects)
          .set({ lastActivityAt: max, updatedAt: new Date() })
          .where(and(
            eq(marketingProspects.id, prospectId),
            eq(marketingProspects.orgId, orgId),
          ));
      }
      return inserted;
    };
    const insertedRows = opts.tx
      ? await run(opts.tx)
      : await db.transaction((t) => run(t as unknown as typeof db));
    // Task #162: invalidate per affected org when any inserted row is a
    // "sent" activity. Batches are bounded to <=1000 rows per call.
    const orgsToInvalidate = new Set<string>();
    for (const r of insertedRows) {
      if (ACTIVITY_TYPES_AFFECTING_LAST_SENT.has(r.type)) {
        orgsToInvalidate.add(r.orgId);
      }
    }
    for (const o of Array.from(orgsToInvalidate)) invalidateBrandStatsCache(o);
    return insertedRows;
  }

  /**
   * Sprint 2f — Hard-delete a single activity row. Returns the deleted row
   * or undefined if the id does not exist OR cross-org. Cross-brand check
   * is handled at the route layer.
   */
  async deleteActivity(
    orgId: string,
    activityId: string,
  ): Promise<ContactActivity | undefined> {
    const [row] = await db
      .delete(contactActivities)
      .where(and(
        eq(contactActivities.id, activityId),
        eq(contactActivities.orgId, orgId),
      ))
      .returning();
    return row;
  }

  /**
   * Append an activity entry. Also bumps `last_activity_at` on the parent
   * contact in the same transaction so list ordering stays accurate.
   * Sprint 2f: now a thin wrapper over createActivity to keep legacy
   * callers (unsubscribe, auto-link emit) working unchanged.
   */
  async createContactActivity(
    data: InsertContactActivity,
  ): Promise<ContactActivity> {
    return this.createActivity(data);
  }

  // ── Marketing OS Sprint 2b: companies ──────────────────────────────────
  // All methods are tenant-scoped by orgId. listCompaniesWithCounts uses a
  // single LATERAL-style correlated subquery (one round trip).

  async listCompanies(
    orgId: string,
    opts: {
      brandId?: string | null;
      q?: string;
      ownerUserId?: string;
      deleted?: "exclude" | "only" | "all";
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<typeof companies.$inferSelect[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);

    const wheres: SQL[] = [eq(companies.orgId, orgId)];
    if (opts.brandId) wheres.push(eq(companies.brandId, opts.brandId));
    if (opts.ownerUserId) wheres.push(eq(companies.ownerUserId, opts.ownerUserId));

    const del = opts.deleted ?? "exclude";
    if (del === "exclude") wheres.push(isNull(companies.deletedAt));
    else if (del === "only") wheres.push(isNotNull(companies.deletedAt));

    if (opts.q && opts.q.trim()) {
      const s = `%${opts.q.trim()}%`;
      wheres.push(or(ilike(companies.name, s), ilike(companies.domain, s))!);
    }

    return db
      .select()
      .from(companies)
      .where(and(...wheres))
      .orderBy(desc(companies.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Single-round-trip list with contactsCount via correlated subquery.
   * Soft-deleted contacts do NOT count toward the total.
   */
  async listCompaniesWithCounts(
    orgId: string,
    opts: {
      brandId?: string | null;
      q?: string;
      ownerUserId?: string;
      deleted?: "exclude" | "only" | "all";
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<Array<typeof companies.$inferSelect & { contactsCount: number }>> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);

    const wheres: SQL[] = [eq(companies.orgId, orgId)];
    if (opts.brandId) wheres.push(eq(companies.brandId, opts.brandId));
    if (opts.ownerUserId) wheres.push(eq(companies.ownerUserId, opts.ownerUserId));

    const del = opts.deleted ?? "exclude";
    if (del === "exclude") wheres.push(isNull(companies.deletedAt));
    else if (del === "only") wheres.push(isNotNull(companies.deletedAt));

    if (opts.q && opts.q.trim()) {
      const s = `%${opts.q.trim()}%`;
      wheres.push(or(ilike(companies.name, s), ilike(companies.domain, s))!);
    }

    const rows = await db
      .select({
        c: companies,
        contactsCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM "client_contacts"
          WHERE "client_contacts"."company_id" = "companies"."id"
            AND "client_contacts"."deleted_at" IS NULL
        )`,
      })
      .from(companies)
      .where(and(...wheres))
      .orderBy(desc(companies.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => ({ ...r.c, contactsCount: Number(r.contactsCount ?? 0) }));
  }

  async getCompany(
    orgId: string,
    id: string,
  ): Promise<typeof companies.$inferSelect | undefined> {
    const [row] = await db
      .select()
      .from(companies)
      .where(and(eq(companies.id, id), eq(companies.orgId, orgId)));
    return row;
  }

  async createCompany(
    orgId: string,
    data: Omit<typeof companies.$inferInsert, "orgId">,
  ): Promise<typeof companies.$inferSelect> {
    const normalized = data.domain ? normalizeDomain(data.domain) : null;
    const [row] = await db
      .insert(companies)
      .values({ ...data, orgId, domain: normalized })
      .returning();
    return row;
  }

  async updateCompany(
    orgId: string,
    id: string,
    patch: Partial<typeof companies.$inferInsert>,
  ): Promise<typeof companies.$inferSelect | undefined> {
    const next: Partial<typeof companies.$inferInsert> = { ...patch, updatedAt: new Date() };
    if (Object.prototype.hasOwnProperty.call(patch, "domain")) {
      next.domain = patch.domain ? normalizeDomain(patch.domain) : null;
    }
    const [row] = await db
      .update(companies)
      .set(next)
      .where(and(eq(companies.id, id), eq(companies.orgId, orgId)))
      .returning();
    return row;
  }

  async softDeleteCompany(
    orgId: string,
    id: string,
  ): Promise<typeof companies.$inferSelect | undefined> {
    const [row] = await db
      .update(companies)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(companies.id, id), eq(companies.orgId, orgId)))
      .returning();
    return row;
  }

  async listCompanyContacts(
    orgId: string,
    companyId: string,
    opts: { limit?: number; offset?: number; deleted?: "exclude" | "only" | "all" } = {},
  ): Promise<typeof clientContacts.$inferSelect[]> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const del = opts.deleted ?? "exclude";

    // Defense-in-depth: explicit org_id predicate even though company_id implies it.
    const wheres: SQL[] = [
      eq(clientContacts.orgId, orgId),
      eq(clientContacts.companyId, companyId),
    ];
    if (del === "exclude") wheres.push(isNull(clientContacts.deletedAt));
    else if (del === "only") wheres.push(isNotNull(clientContacts.deletedAt));

    return db
      .select()
      .from(clientContacts)
      .where(and(...wheres))
      .orderBy(desc(clientContacts.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async findCompanyByDomain(
    orgId: string,
    brandId: string | null,
    domain: string,
  ): Promise<typeof companies.$inferSelect | undefined> {
    if (!normalizeDomain(domain)) return undefined;
    const wheres: SQL[] = [
      eq(companies.orgId, orgId),
      eq(companies.domain, domain),
      isNull(companies.deletedAt),
    ];
    if (brandId === null) wheres.push(isNull(companies.brandId));
    else wheres.push(eq(companies.brandId, brandId));
    const [row] = await db.select().from(companies).where(and(...wheres));
    return row;
  }

  /**
   * Transactional find-or-create. The partial unique index
   * (org_id, brand_id, domain) WHERE domain IS NOT NULL AND deleted_at IS NULL
   * is the ultimate guard; SELECT…FOR UPDATE narrows the race window.
   */
  async findOrCreateCompanyByDomain(
    orgId: string,
    brandId: string | null,
    domain: string,
    name?: string,
  ): Promise<typeof companies.$inferSelect> {
    const normalized = normalizeDomain(domain);
    if (!normalized) throw new Error(`Invalid domain: ${domain}`);
    return db.transaction(async (tx) => {
      const wheres: SQL[] = [
        eq(companies.orgId, orgId),
        eq(companies.domain, normalized),
        isNull(companies.deletedAt),
      ];
      if (brandId === null) wheres.push(isNull(companies.brandId));
      else wheres.push(eq(companies.brandId, brandId));
      const [existing] = await tx
        .select()
        .from(companies)
        .where(and(...wheres))
        .for("update");
      if (existing) return existing;
      const [created] = await tx
        .insert(companies)
        .values({
          orgId,
          brandId: brandId ?? null,
          name: name ?? normalized,
          domain: normalized,
          source: "auto_domain",
        })
        .returning();
      return created;
    });
  }

  async countCompanyContacts(orgId: string, companyId: string): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(clientContacts)
      .where(and(
        eq(clientContacts.orgId, orgId),
        eq(clientContacts.companyId, companyId),
        isNull(clientContacts.deletedAt),
      ));
    return Number(row?.n ?? 0);
  }

  /**
   * Activities for a company = activities for any contact whose
   * company_id = this company. Joined through client_contacts.
   */
  async listCompanyActivities(
    orgId: string,
    companyId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<Array<typeof psoContactActivities.$inferSelect & { contactId: string; contactName: string | null }>> {
    // Sprint 2o.0 Step 5b1e (HR4): retargeted from contact_activities to
    // pso_contact_activities. The new table carries `client_contact_id`
    // (typed FK to clientContacts.id) instead of the legacy
    // `contact_activities.contact_id` (Dropped in Step 5b2 on 2026-04-23).
    // The (org_id, company_id, created_at DESC) index is built specifically
    // for this query — index seek + no Sort node.
    //
    // 5b3-ALIAS-REMOVAL-PENDING: the public return shape preserves
    // `contactId` (mapped from `clientContactId`) so route + frontend
    // consumers continue to work unchanged in 5b1e. Step 5b3 will rename
    // the public field to `clientContactId` end-to-end and delete this
    // alias.
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const offset = Math.max(opts.offset ?? 0, 0);
    const rows = await db
      .select({
        a: psoContactActivities,
        firstName: clientContacts.firstName,
        lastName: clientContacts.lastName,
      })
      .from(psoContactActivities)
      .innerJoin(clientContacts, eq(clientContacts.id, psoContactActivities.clientContactId))
      .where(and(
        eq(psoContactActivities.orgId, orgId),
        eq(clientContacts.orgId, orgId),
        eq(clientContacts.companyId, companyId),
      ))
      .orderBy(desc(psoContactActivities.createdAt))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({
      ...r.a,
      // 5b3-ALIAS-REMOVAL-PENDING: public alias preserved for consumers.
      contactId: r.a.clientContactId,
      contactName: [r.firstName, r.lastName].filter(Boolean).join(" ") || null,
    }));
  }

  /**
   * SET-ONLY auto-link rule. Lives ENTIRELY in storage. Routes never
   * call this directly. Triggered from createContact + updateContact when
   * email is present AND companyId is currently NULL AND domain is not free-mail.
   * Never overwrites an existing companyId. Never clears one.
   */
  private async maybeAutoLinkContactCompany(
    contact: typeof clientContacts.$inferSelect,
  ): Promise<typeof clientContacts.$inferSelect> {
    if (contact.companyId) return contact;          // (b) already set → no-op
    if (!contact.email) return contact;             // (a) no email → no-op
    const domain = extractDomainFromEmail(contact.email);
    if (!domain) return contact;                    // malformed → no-op
    if (isFreeMailDomain(domain)) return contact;   // (c) free-mail → no-op

    const company = await this.findOrCreateCompanyByDomain(
      contact.orgId,
      contact.brandId ?? null,
      domain,
      domain,
    );
    const [updated] = await db
      .update(clientContacts)
      .set({ companyId: company.id, updatedAt: new Date() })
      .where(and(
        eq(clientContacts.id, contact.id),
        eq(clientContacts.orgId, contact.orgId),
        isNull(clientContacts.companyId),
      ))
      .returning();
    if (!updated) return contact; // race: someone else set it; respect set-only

    // Sprint 2o.0 Step 5b1e (HR4): retargeted from contact_activities (legacy
    // PSO contactId path being dropped in 5b2) to the new PSO-only
    // pso_contact_activities table. Payload preserved verbatim — listeners
    // continue to read { companyId, via, domain } unchanged. NO brandId per
    // HR4. companyId column populated with the freshly-linked company.id so
    // the per-company timeline (listCompanyActivities) surfaces the link.
    await db.insert(psoContactActivities).values({
      orgId: contact.orgId,
      clientContactId: contact.id,
      companyId: company.id,
      type: "company_linked" satisfies PsoContactActivityType,
      payload: { companyId: company.id, via: "auto_domain", domain },
    });
    return updated;
  }

  /**
   * Public hook used by route layer to ensure auto-link runs after create
   * or update. Idempotent — calling twice is a no-op once linked.
   */
  async runContactAutoLink(
    contactId: string,
    orgId: string,
  ): Promise<typeof clientContacts.$inferSelect | undefined> {
    const [c] = await db
      .select()
      .from(clientContacts)
      .where(and(eq(clientContacts.id, contactId), eq(clientContacts.orgId, orgId)));
    if (!c) return undefined;
    return this.maybeAutoLinkContactCompany(c);
  }

  // ────────────────────────────────────────────────────────────────────
  // Sprint 2o.0 — marketing_prospects + marketing_companies storage
  //
  // These tables are decoupled from the PSO (clients / client_contacts)
  // tree per HR4: there is no FK from marketing_* to PSO. The convert*
  // helpers below are the *only* code path that should ever materialize
  // a PSO row from a marketing entity. They write soft-ref columns on
  // both sides:
  //
  //   marketing_prospects.converted_to_client_contact_id  ← new contact
  //   client_contacts.originated_from_prospect_id         ← source prospect
  //   marketing_companies.converted_to_client_id          ← new client
  //   clients.originated_from_marketing_company_id        ← source company
  //
  // Conversion is idempotent and reuses the parent client when the
  // prospect's marketing_company has already been converted, so every
  // contact for a converted company lands on the same client.
  // ────────────────────────────────────────────────────────────────────

  async listProspectsByOrg(
    orgId: string,
    opts?: {
      brandId?: string;
      lifecycleStage?: MarketingProspectLifecycleStage;
      includeDeleted?: boolean;
      search?: string;
      tagIds?: string[];
      limit?: number;
      offset?: number;
    },
  ): Promise<MarketingProspect[]> {
    const wheres: SQL[] = [eq(marketingProspects.orgId, orgId)];
    if (!opts?.includeDeleted) wheres.push(isNull(marketingProspects.deletedAt));
    if (opts?.brandId) wheres.push(eq(marketingProspects.brandId, opts.brandId));
    if (opts?.lifecycleStage) wheres.push(eq(marketingProspects.lifecycleStage, opts.lifecycleStage));
    if (opts?.search?.trim()) {
      const s = `%${opts.search.trim()}%`;
      wheres.push(
        or(
          ilike(marketingProspects.firstName, s),
          ilike(marketingProspects.lastName, s),
          ilike(marketingProspects.email, s),
          ilike(marketingProspects.title, s),
        )!,
      );
    }
    if (opts?.tagIds && opts.tagIds.length > 0) {
      // Sprint 2d AND-intersection: prospect must have ALL specified tags.
      const sub = db
        .select({ prospectId: contactTagAssignments.prospectId })
        .from(contactTagAssignments)
        .where(inArray(contactTagAssignments.tagId, opts.tagIds))
        .groupBy(contactTagAssignments.prospectId)
        .having(sql`count(distinct ${contactTagAssignments.tagId}) = ${opts.tagIds.length}`);
      wheres.push(inArray(marketingProspects.id, sub));
    }
    return db
      .select()
      .from(marketingProspects)
      .where(and(...wheres))
      .orderBy(desc(marketingProspects.createdAt))
      .limit(opts?.limit ?? 200)
      .offset(opts?.offset ?? 0);
  }

  async getProspect(id: string, orgId: string): Promise<MarketingProspect | undefined> {
    const [row] = await db
      .select()
      .from(marketingProspects)
      .where(and(eq(marketingProspects.id, id), eq(marketingProspects.orgId, orgId)));
    return row;
  }

  async listProspectsByCompany(
    orgId: string,
    companyId: string,
  ): Promise<MarketingProspect[]> {
    return db
      .select()
      .from(marketingProspects)
      .where(and(
        eq(marketingProspects.orgId, orgId),
        eq(marketingProspects.companyId, companyId),
        isNull(marketingProspects.deletedAt),
      ))
      .orderBy(desc(marketingProspects.createdAt))
      .limit(500);
  }

  async createProspect(data: InsertMarketingProspect): Promise<MarketingProspect> {
    const [row] = await db.insert(marketingProspects).values(data).returning();
    // Sprint 2o.0 5b1c.1 (Blocker A): brand-stats contactCount now reflects
    // marketing_prospects, so prospect mutations must invalidate the cache.
    invalidateBrandStatsCache(row.orgId);
    return row;
  }

  async updateProspect(
    id: string,
    orgId: string,
    data: Partial<InsertMarketingProspect>,
  ): Promise<MarketingProspect | undefined> {
    const [row] = await db
      .update(marketingProspects)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(marketingProspects.id, id), eq(marketingProspects.orgId, orgId)))
      .returning();
    // Sprint 2o.0 5b1c.1 (Blocker A): brand reassignment / deletedAt change
    // shifts per-brand contactCount.
    if (row) invalidateBrandStatsCache(orgId);
    return row;
  }

  async softDeleteProspect(id: string, orgId: string): Promise<MarketingProspect | undefined> {
    const now = new Date();
    const [row] = await db
      .update(marketingProspects)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(marketingProspects.id, id), eq(marketingProspects.orgId, orgId)))
      .returning();
    // Sprint 2o.0 5b1c.1 (Blocker A): prospect soft-delete bumps the per-brand
    // contactCount aggregate served by listBrandsByOrg.
    if (row) invalidateBrandStatsCache(orgId);
    return row;
  }

  async listMarketingCompaniesByOrg(
    orgId: string,
    opts?: {
      brandId?: string;
      lifecycleStage?: string;
      includeDeleted?: boolean;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<MarketingCompany[]> {
    const wheres: SQL[] = [eq(marketingCompanies.orgId, orgId)];
    if (!opts?.includeDeleted) wheres.push(isNull(marketingCompanies.deletedAt));
    if (opts?.brandId) wheres.push(eq(marketingCompanies.brandId, opts.brandId));
    if (opts?.lifecycleStage) wheres.push(eq(marketingCompanies.lifecycleStage, opts.lifecycleStage));
    if (opts?.search?.trim()) {
      const s = `%${opts.search.trim()}%`;
      wheres.push(
        or(
          ilike(marketingCompanies.name, s),
          ilike(marketingCompanies.domain, s),
          ilike(marketingCompanies.industry, s),
        )!,
      );
    }
    return db
      .select()
      .from(marketingCompanies)
      .where(and(...wheres))
      .orderBy(desc(marketingCompanies.createdAt))
      .limit(opts?.limit ?? 200)
      .offset(opts?.offset ?? 0);
  }

  async getMarketingCompany(id: string, orgId: string): Promise<MarketingCompany | undefined> {
    const [row] = await db
      .select()
      .from(marketingCompanies)
      .where(and(eq(marketingCompanies.id, id), eq(marketingCompanies.orgId, orgId)));
    return row;
  }

  async createMarketingCompany(data: InsertMarketingCompany): Promise<MarketingCompany> {
    const [row] = await db.insert(marketingCompanies).values(data).returning();
    return row;
  }

  async updateMarketingCompany(
    id: string,
    orgId: string,
    data: Partial<InsertMarketingCompany>,
  ): Promise<MarketingCompany | undefined> {
    const [row] = await db
      .update(marketingCompanies)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(marketingCompanies.id, id), eq(marketingCompanies.orgId, orgId)))
      .returning();
    return row;
  }

  async softDeleteMarketingCompany(id: string, orgId: string): Promise<MarketingCompany | undefined> {
    const now = new Date();
    const [row] = await db
      .update(marketingCompanies)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(marketingCompanies.id, id), eq(marketingCompanies.orgId, orgId)))
      .returning();
    return row;
  }

  /**
   * Convert a marketing_company → clients row. Idempotent: if the
   * marketing_company has already been converted, returns the existing
   * client (alreadyConverted=true) without creating a duplicate.
   *
   * Writes soft-ref columns on BOTH sides:
   *   - marketing_companies.converted_to_client_id, converted_at, lifecycle_stage="customer"
   *   - clients.originated_from_marketing_company_id, marketing_converted_at
   */
  async convertMarketingCompanyToClient(
    orgId: string,
    companyId: string,
    opts: { clientOverrides?: Partial<InsertClient> } = {},
  ): Promise<{ client: Client; alreadyConverted: boolean }> {
    const company = await this.getMarketingCompany(companyId, orgId);
    if (!company) throw new Error("marketing_company not found");
    if (company.deletedAt) throw new Error("marketing_company is deleted");

    if (company.convertedToClientId) {
      const existing = await this.getClient(company.convertedToClientId, orgId);
      if (existing) return { client: existing, alreadyConverted: true };
      // Soft ref points at a missing client (e.g. PSO row was deleted).
      // Fall through and create a fresh one; the soft ref will be
      // overwritten below to point at the new row.
    }

    const now = new Date();
    const baseClient: InsertClient = {
      orgId,
      name: company.name,
      website: company.website ?? undefined,
      brandId: company.brandId ?? undefined,
      industry: company.industry ?? undefined,
      employeeCount: company.employeeCount ?? undefined,
      annualRevenue: company.annualRevenue != null ? String(company.annualRevenue) : undefined,
      lifecycleStage: "customer",
      source: "marketing",
      originatedFromMarketingCompanyId: company.id,
      marketingConvertedAt: now,
      ...(opts.clientOverrides ?? {}),
    };
    const client = await this.createClient(baseClient);

    await db
      .update(marketingCompanies)
      .set({
        convertedToClientId: client.id,
        convertedAt: now,
        lifecycleStage: "customer",
        updatedAt: now,
      })
      .where(and(eq(marketingCompanies.id, company.id), eq(marketingCompanies.orgId, orgId)));

    return { client, alreadyConverted: false };
  }

  /**
   * Convert a marketing_prospect → client_contacts row. Idempotent: if
   * the prospect already has converted_to_client_contact_id and that
   * contact still exists, returns it (alreadyConverted=true).
   *
   * If the prospect has a company_id, the parent client is resolved as
   * follows:
   *   1. If the marketing_company has already been converted →
   *      reuse that client (reusedExistingClient=true)
   *   2. Else, if opts.createClient !== false → convert the company too
   *   3. Else, leave the contact unparented (clientId=null)
   */
  async convertProspectToCustomer(
    orgId: string,
    prospectId: string,
    opts: {
      createClient?: boolean;
      clientOverrides?: Partial<InsertClient>;
      clientContactOverrides?: Partial<InsertClientContact>;
    } = {},
  ): Promise<{
    clientContact: ClientContact;
    client: Client | null;
    reusedExistingClient: boolean;
    alreadyConverted: boolean;
  }> {
    const prospect = await this.getProspect(prospectId, orgId);
    if (!prospect) throw new Error("marketing_prospect not found");
    if (prospect.deletedAt) throw new Error("marketing_prospect is deleted");

    if (prospect.convertedToClientContactId) {
      const [existing] = await db
        .select()
        .from(clientContacts)
        .where(and(
          eq(clientContacts.id, prospect.convertedToClientContactId),
          eq(clientContacts.orgId, orgId),
        ));
      if (existing) {
        const parent = existing.clientId
          ? (await this.getClient(existing.clientId, orgId)) ?? null
          : null;
        return {
          clientContact: existing,
          client: parent,
          reusedExistingClient: false,
          alreadyConverted: true,
        };
      }
      // Soft ref points at a missing contact; fall through and create.
    }

    let client: Client | null = null;
    let reusedExistingClient = false;
    const createClient = opts.createClient !== false;

    if (prospect.companyId) {
      const company = await this.getMarketingCompany(prospect.companyId, orgId);
      if (company && !company.deletedAt) {
        if (company.convertedToClientId) {
          const existingClient = await this.getClient(company.convertedToClientId, orgId);
          if (existingClient) {
            client = existingClient;
            reusedExistingClient = true;
          }
        }
        if (!client && createClient) {
          const out = await this.convertMarketingCompanyToClient(orgId, company.id, {
            clientOverrides: opts.clientOverrides,
          });
          client = out.client;
          reusedExistingClient = out.alreadyConverted;
        }
      }
    }

    const now = new Date();
    const baseContact: InsertClientContact = {
      orgId,
      clientId: client?.id ?? null,
      brandId: prospect.brandId ?? undefined,
      firstName: prospect.firstName ?? "",
      lastName: prospect.lastName ?? "",
      email: prospect.email ?? undefined,
      phone: prospect.phone ?? undefined,
      title: prospect.title ?? undefined,
      linkedinUrl: prospect.linkedinUrl ?? undefined,
      location: prospect.location ?? undefined,
      lifecycleStage: "customer",
      source: prospect.leadSource ?? "marketing",
      ownerUserId: prospect.ownerUserId ?? undefined,
      originatedFromProspectId: prospect.id,
      marketingConvertedAt: now,
      ...(opts.clientContactOverrides ?? {}),
    };
    const [clientContact] = await db.insert(clientContacts).values(baseContact).returning();

    await db
      .update(marketingProspects)
      .set({
        convertedToClientContactId: clientContact.id,
        convertedAt: now,
        lifecycleStage: "converted",
        updatedAt: now,
      })
      .where(and(eq(marketingProspects.id, prospect.id), eq(marketingProspects.orgId, orgId)));

    return { clientContact, client, reusedExistingClient, alreadyConverted: false };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Sprint M-Chat-1 — Marketing chatbot CRUD.
  //
  // Every method here is org+brand-scoped. NONE of them read or write
  // `clients`, `client_contacts`, `invoices`, `estimates`, `expenses`,
  // `projects`, or `time_entries`. Soft email→lead capture writes ONLY
  // to `marketing_prospects` (HR4: marketing surfaces never reach into
  // PSO/accounting tables). Verified by the HR4 sweep in Wave 6.
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Look up a brand by slug for the chat embed. Returns the minimal
   * fields the route needs, or null on miss. Never throws — the caller
   * decides whether the miss should produce a stealth 404.
   */
  async getBrandBySlugForChat(slug: string): Promise<{
    id: string;
    orgId: string;
    name: string;
    primaryColor: string | null;
    chatEnabled: boolean | null;
    chatPersonaName: string | null;
    chatWelcomeMessage: string | null;
    chatSystemPrompt: string | null;
  } | null> {
    if (!slug || typeof slug !== "string") return null;
    const [row] = await db
      .select({
        id: brands.id,
        orgId: brands.orgId,
        name: brands.name,
        primaryColor: brands.primaryColor,
        chatEnabled: brands.chatEnabled,
        chatPersonaName: brands.chatPersonaName,
        chatWelcomeMessage: brands.chatWelcomeMessage,
        chatSystemPrompt: brands.chatSystemPrompt,
      })
      .from(brands)
      .where(and(eq(brands.slug, slug), eq(brands.active, true)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Idempotent get-or-create on (brandId, sessionToken). The unique
   * index `marketing_chat_conv_brand_session_uniq` guarantees the same
   * session always resolves to the same conversation row.
   */
  async getOrCreateChatConversation(params: {
    orgId: string;
    brandId: string;
    sessionToken: string;
  }): Promise<MarketingChatConversation> {
    const { orgId, brandId, sessionToken } = params;
    const [existing] = await db
      .select()
      .from(marketingChatConversations)
      .where(
        and(
          eq(marketingChatConversations.brandId, brandId),
          eq(marketingChatConversations.sessionToken, sessionToken),
        ),
      )
      .limit(1);
    if (existing) return existing;

    const [created] = await db
      .insert(marketingChatConversations)
      .values({
        orgId,
        brandId,
        sessionToken,
        status: "active",
      } satisfies InsertMarketingChatConversation)
      .onConflictDoNothing({
        target: [
          marketingChatConversations.brandId,
          marketingChatConversations.sessionToken,
        ],
      })
      .returning();
    if (created) return created;

    // Lost the race against another concurrent insert — re-read.
    const [raceWinner] = await db
      .select()
      .from(marketingChatConversations)
      .where(
        and(
          eq(marketingChatConversations.brandId, brandId),
          eq(marketingChatConversations.sessionToken, sessionToken),
        ),
      )
      .limit(1);
    if (!raceWinner) {
      throw new Error(
        "[chat] getOrCreateChatConversation lost insert race but cannot find row",
      );
    }
    return raceWinner;
  }

  /**
   * Append a message and bump the conversation's last_message_at +
   * running token totals. Returns the inserted message.
   */
  async appendChatMessage(params: {
    conversationId: string;
    role: MarketingChatMessageRole;
    content: string;
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
  }): Promise<MarketingChatMessage> {
    const { conversationId, role, content, model, tokensIn, tokensOut } = params;
    // Wrap insert + counter bump in a single transaction so a crash
    // between the two writes never leaves the conversation totals
    // out of sync with persisted messages.
    return await db.transaction(async (tx) => {
      const [msg] = await tx
        .insert(marketingChatMessages)
        .values({
          conversationId,
          role,
          content,
          model: model ?? null,
          tokensIn: tokensIn ?? null,
          tokensOut: tokensOut ?? null,
        })
        .returning();

      await tx
        .update(marketingChatConversations)
        .set({
          lastMessageAt: new Date(),
          tokensInTotal: sql`${marketingChatConversations.tokensInTotal} + ${tokensIn ?? 0}`,
          tokensOutTotal: sql`${marketingChatConversations.tokensOutTotal} + ${tokensOut ?? 0}`,
        })
        .where(eq(marketingChatConversations.id, conversationId));

      return msg;
    });
  }

  /** Returns messages oldest→newest, capped to `limit` most recent turns. */
  async getConversationMessages(
    conversationId: string,
    limit: number = 40,
  ): Promise<MarketingChatMessage[]> {
    // Fetch the most recent N then return in chronological order.
    const recent = await db
      .select()
      .from(marketingChatMessages)
      .where(eq(marketingChatMessages.conversationId, conversationId))
      .orderBy(desc(marketingChatMessages.createdAt))
      .limit(limit);
    return recent.reverse();
  }

  /**
   * One-shot link: sets prospect_id only when currently NULL. Re-calls
   * are no-ops; the conversation keeps its first prospect attribution.
   */
  async linkConversationToProspect(
    conversationId: string,
    prospectId: string,
  ): Promise<void> {
    await db
      .update(marketingChatConversations)
      .set({ prospectId })
      .where(
        and(
          eq(marketingChatConversations.id, conversationId),
          isNull(marketingChatConversations.prospectId),
        ),
      );
  }

  /**
   * Soft lead capture from a chat message. Upserts on (orgId, email)
   * via the existing `marketing_prospects_org_email_uniq` partial index.
   * Sets lead_source='chatbot' and lifecycleStage='lead' on insert; on
   * conflict, updates last_activity_at + appends a note about the new
   * conversation.
   *
   * IMPORTANT (HR4): writes ONLY to `marketing_prospects`. Never to
   * `client_contacts`, `clients`, or any accounting table.
   */
  async softCreateProspectFromChat(params: {
    orgId: string;
    brandId: string;
    email: string;
    conversationId: string;
    firstSeenMessage: string;
  }): Promise<{ id: string; created: boolean }> {
    const { orgId, brandId, email, conversationId, firstSeenMessage } = params;
    const normalizedEmail = email.trim().toLowerCase();
    const noteExcerpt = firstSeenMessage.slice(0, 240);
    const noteBlock = `[chatbot conversation ${conversationId}] ${noteExcerpt}`;
    const now = new Date();

    // Select-then-write inside a transaction. We deliberately avoid
    // INSERT … ON CONFLICT (org_id, email) here because the unique
    // index `marketing_prospects_org_email_uniq` is partial
    // (`WHERE email IS NOT NULL`), and Postgres will not infer a
    // partial unique index from a bare conflict target — it would raise
    // "no unique or exclusion constraint matching ON CONFLICT
    // specification" at runtime. Email is already validated non-null
    // by the caller, so the partial index still protects us against
    // races: a concurrent insert will fail with 23505 and we re-read.
    return await db.transaction(async (tx) => {
      const tryReadExisting = async () =>
        (
          await tx
            .select({
              id: marketingProspects.id,
              notes: marketingProspects.notes,
            })
            .from(marketingProspects)
            .where(
              and(
                eq(marketingProspects.orgId, orgId),
                eq(marketingProspects.email, normalizedEmail),
              ),
            )
            .limit(1)
        )[0];

      const existing = await tryReadExisting();
      if (existing) {
        const newNotes = existing.notes
          ? `${existing.notes}\n${noteBlock}`
          : noteBlock;
        await tx
          .update(marketingProspects)
          .set({ lastActivityAt: now, notes: newNotes, updatedAt: now })
          .where(eq(marketingProspects.id, existing.id));
        return { id: existing.id, created: false };
      }

      try {
        const [created] = await tx
          .insert(marketingProspects)
          .values({
            orgId,
            brandId,
            email: normalizedEmail,
            leadSource: "chatbot",
            lifecycleStage: "lead",
            notes: noteBlock,
            lastActivityAt: now,
          })
          .returning({ id: marketingProspects.id });
        invalidateBrandStatsCache(orgId);
        return { id: created.id, created: true };
      } catch (err: any) {
        // Concurrent insert from a parallel chat turn — re-read and
        // treat it as an update.
        if (err?.code !== "23505") throw err;
        const racy = await tryReadExisting();
        if (!racy) throw err;
        const newNotes = racy.notes
          ? `${racy.notes}\n${noteBlock}`
          : noteBlock;
        await tx
          .update(marketingProspects)
          .set({ lastActivityAt: now, notes: newNotes, updatedAt: now })
          .where(eq(marketingProspects.id, racy.id));
        return { id: racy.id, created: false };
      }
    });
  }
}

export const storage = new DatabaseStorage();
