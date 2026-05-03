import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  integer,
  bigint,
  serial,
  boolean,
  timestamp,
  date,
  numeric,
  json,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
  unique,
  foreignKey,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const roleEnum = pgEnum("user_role", ["ADMIN", "MANAGER", "TEAM_MEMBER"]);
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "DRAFT",
  "SENT",
  "PAID",
  "PARTIAL",
  "VOID",
]);
export const payoutStatusEnum = pgEnum("payout_status", [
  "PENDING",
  "COMPLETED",
  "VOID",
]);

export const glAccountTypeEnum = pgEnum("gl_account_type", [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
  "COST_OF_SERVICES",
]);

export const emailProviderTypeEnum = pgEnum("email_provider_type", ["m365", "google", "smtp"]);

export const projectStatusEnum = pgEnum("project_status", [
  "ACTIVE",
  "COMPLETED",
  "ON_HOLD",
  "ARCHIVED",
]);

export const orgs = pgTable("orgs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  invoicePrefix: text("invoice_prefix"),
  estimatePrefix: text("estimate_prefix"),
  defaultPaymentTermsDays: integer("default_payment_terms_days").default(30),
  defaultTaxRate: numeric("default_tax_rate", { precision: 10, scale: 2 }).default("0"),
  address: text("address"),
  addressStreet: text("address_street"),
  addressSuite: text("address_suite"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  addressZip: text("address_zip"),
  addressCountry: text("address_country"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  reminderEnabled: boolean("reminder_enabled").default(false),
  reminderDaysOverdue: jsonb("reminder_days_overdue").default(sql`'[3, 7, 14, 30]'::jsonb`),
  reminderSubjectTemplate: text("reminder_subject_template").default("Reminder: Invoice {{number}} is overdue"),
  reminderBodyTemplate: text("reminder_body_template").default("Dear {{clientName}},\n\nInvoice {{number}} for {{total}} was due on {{dueDate}}. Please remit payment at your earliest convenience.\n\nView invoice: {{viewLink}}\n\nThank you,\n{{orgName}}"),
  baseCurrency: varchar("base_currency", { length: 3 }).notNull().default("USD"),
  planTier: text("plan_tier").notNull().default("TRIAL"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status").notNull().default("trialing"),
  maxTeamMembers: integer("max_team_members").notNull().default(15),
  trialEndsAt: timestamp("trial_ends_at"),
  invoiceTheme: text("invoice_theme").notNull().default("classic"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPass: text("smtp_pass"),
  smtpFromName: text("smtp_from_name"),
  smtpFromEmail: text("smtp_from_email"),
  smtpReplyTo: text("smtp_reply_to"),
  lastSuccessfulSmtpSendAt: timestamp("last_successful_smtp_send_at"),
  emailProviderType: emailProviderTypeEnum("email_provider_type").notNull().default("smtp"),
  emailOauthRefreshToken: text("email_oauth_refresh_token"),
  emailOauthExpiresAt: timestamp("email_oauth_expires_at"),
  emailOauthScopes: text("email_oauth_scopes"),
  emailSenderAddress: varchar("email_sender_address", { length: 320 }),
  emailOauthConnectedAt: timestamp("email_oauth_connected_at"),
  emailOauthStatus: text("email_oauth_status").notNull().default("ok"),
  emailOauthLastErrorAt: timestamp("email_oauth_last_error_at"),
  emailOauthLastErrorMessage: text("email_oauth_last_error_message"),
  emailOauthFailedSendCount: integer("email_oauth_failed_send_count").notNull().default(0),
  autoPostJournalEntries: boolean("auto_post_journal_entries").default(true).notNull(),
  dateFormat: varchar("date_format", { length: 20 }).default("MM/DD/YYYY"),
  taxCalculationMode: varchar("tax_calculation_mode", { length: 30 }).notNull().default("tax_after_discount"),
  defaultBillRate: integer("default_bill_rate").notNull().default(125),
  apiKey: text("api_key"),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  dataRetentionDays: integer("data_retention_days").default(0),
  rateLimitRpm: integer("rate_limit_rpm").default(600),
  marketingSendMaxAttempts: integer("marketing_send_max_attempts").notNull().default(5),
  marketingSendRetryBaseMs: integer("marketing_send_retry_base_ms").notNull().default(300000),
  // Task #314 — per-org override for the silenced-send (suppression-list)
  // per-hour warning threshold. NULL means "fall back to the
  // EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR env value (or the
  // hard-coded default)" so an admin who never touches this setting
  // continues to inherit any platform-wide tuning.
  emailSuppressedAlertThresholdPerHour: integer(
    "email_suppressed_alert_threshold_per_hour",
  ),
  marketingLargeAudienceThreshold: integer("marketing_large_audience_threshold").notNull().default(1000),
  deletionRequestedAt: timestamp("deletion_requested_at"),
  deletionScheduledFor: timestamp("deletion_scheduled_for"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const orgEmailAlertWebhooks = pgTable("org_email_alert_webhooks", {
  orgId: varchar("org_id", { length: 36 })
    .primaryKey()
    .references(() => orgs.id, { onDelete: "cascade" }),
  webhookUrl: text("webhook_url").notNull(),
  cooldownMs: integer("cooldown_ms"),
  updatedBy: varchar("updated_by", { length: 36 }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastTestedAt: timestamp("last_tested_at"),
  lastTestOk: boolean("last_test_ok"),
  lastTestError: text("last_test_error"),
  consecutiveFailureCount: integer("consecutive_failure_count")
    .notNull()
    .default(0),
  failureAlertSentAt: timestamp("failure_alert_sent_at"),
});

export const insertOrgEmailAlertWebhookSchema = createInsertSchema(
  orgEmailAlertWebhooks,
).omit({
  updatedAt: true,
  lastTestedAt: true,
  lastTestOk: true,
  lastTestError: true,
  consecutiveFailureCount: true,
  failureAlertSentAt: true,
});
export type InsertOrgEmailAlertWebhook = z.infer<
  typeof insertOrgEmailAlertWebhookSchema
>;
export type OrgEmailAlertWebhook = typeof orgEmailAlertWebhooks.$inferSelect;

export const emailAlertWebhookTests = pgTable("email_alert_webhook_tests", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  testedAt: timestamp("tested_at").defaultNow().notNull(),
  ok: boolean("ok").notNull(),
  errorMessage: text("error_message"),
}, (table) => [
  index("idx_email_alert_webhook_tests_org_time")
    .on(table.orgId, table.testedAt.desc()),
]);
export type EmailAlertWebhookTest = typeof emailAlertWebhookTests.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  email: text("email").notNull(),
  password: text("password").notNull(),
  /** @deprecated Use firstName + lastName instead. Kept for backward compatibility during deprecation window. */
  name: text("name").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  title: text("title"),
  department: text("department"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  role: roleEnum("role").notNull().default("TEAM_MEMBER"),
  isActive: boolean("is_active").notNull().default(true),
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  tempPassword: boolean("temp_password").notNull().default(false),
  lastLoginAt: timestamp("last_login_at"),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  // Business entity
  legalName: text("legal_name"),
  payToName: text("pay_to_name"),
  ein: text("ein"),
  // Mailing address (structured)
  mailingAddress: text("mailing_address"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  addressZip: text("address_zip"),
  addressCountry: text("address_country"),
  // Tax
  taxIdLast4: varchar("tax_id_last4", { length: 4 }),
  is1099Eligible: boolean("is_1099_eligible").notNull().default(false),
  // Payment info
  paymentMethod: text("payment_method"),
  bankName: text("bank_name"),
  bankRoutingNumber: text("bank_routing_number"),
  bankAccountNumber: text("bank_account_number"),
  bankAccountType: text("bank_account_type"),
  zelleContact: text("zelle_contact"),
  // Compliance
  w9OnFile: boolean("w9_on_file").notNull().default(false),
  agreementSigned: boolean("agreement_signed").notNull().default(false),
  workerType: text("worker_type").notNull().default("INDEPENDENT"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  payrollProviderId: text("payroll_provider_id"),
  payrollProviderName: text("payroll_provider_name"),
  hourlyPayRate: text("hourly_pay_rate"),
  salaryAmount: text("salary_amount"),
  defaultCostRateHourly: numeric("default_cost_rate_hourly", { precision: 10, scale: 2 }),
  payType: text("pay_type"),
  notes: text("notes"),
  // Stripe Connect
  stripeConnectAccountId: text("stripe_connect_account_id"),
  stripeConnectStatus: text("stripe_connect_status").notNull().default("NOT_STARTED"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  uniqueOrgEmail: uniqueIndex("users_org_email_unique").on(table.orgId, table.email),
  orgIdIdx: index("idx_users_org_id").on(table.orgId),
}));

export const clients = pgTable("clients", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  website: text("website"),
  logoUrl: text("logo_url"),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  portalToken: varchar("portal_token", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // ── Marketing OS Sprint 2a extension columns (all nullable) ──────────
  brandId: varchar("brand_id", { length: 36 }).references((): AnyPgColumn => brands.id),
  lifecycleStage: text("lifecycle_stage").default("lead"),
  source: text("source").default("manual"),
  industry: text("industry"),
  employeeCount: integer("employee_count"),
  annualRevenue: numeric("annual_revenue"),
  apolloId: text("apollo_id"),
  // ── Sprint 2o.0: soft reverse-link to marketing_companies (no FK per HR4) ─
  originatedFromMarketingCompanyId: varchar("originated_from_marketing_company_id", { length: 36 }),
  marketingConvertedAt: timestamp("marketing_converted_at"),
}, (table) => ({
  clientsOrgBrandIdx: index("clients_org_brand_idx").on(table.orgId, table.brandId),
  orgIdIdx: index("idx_clients_org_id").on(table.orgId),
}));

export const clientNotes = pgTable("client_notes", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  clientId: varchar("client_id", { length: 36 })
    .notNull()
    .references(() => clients.id),
  authorId: varchar("author_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  body: text("body").notNull(),
  isPinned: boolean("is_pinned").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgClientIdx: index("client_notes_org_client_idx").on(table.orgId, table.clientId),
}));

export const clientActivities = pgTable("client_activities", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  clientId: varchar("client_id", { length: 36 })
    .notNull()
    .references(() => clients.id),
  userId: varchar("user_id", { length: 36 })
    .references(() => users.id),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  linkUrl: text("link_url"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgClientCreatedIdx: index("client_activities_org_client_created_idx").on(table.orgId, table.clientId, table.createdAt),
}));

export const clientContacts = pgTable("client_contacts", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  // Marketing OS Sprint 2a: relaxed to NULLABLE so a pure marketing lead
  // (not yet a billing client) can exist. Existing rows are unaffected.
  clientId: varchar("client_id", { length: 36 }).references(() => clients.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  role: text("role"),
  isPrimary: boolean("is_primary").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // ── Marketing OS Sprint 2a extension columns (all nullable) ──────────
  brandId: varchar("brand_id", { length: 36 }).references((): AnyPgColumn => brands.id),
  lifecycleStage: text("lifecycle_stage").default("lead"),
  leadStatus: text("lead_status").default("new"),
  source: text("source").default("manual"),
  ownerUserId: varchar("owner_user_id", { length: 36 }).references(() => users.id),
  enrichedAt: timestamp("enriched_at"),
  apolloId: text("apollo_id"),
  linkedinUrl: text("linkedin_url"),
  twitterUrl: text("twitter_url"),
  companyName: text("company_name"),
  title: text("title"),
  location: text("location"),
  unsubscribedAt: timestamp("unsubscribed_at"),
  bouncedAt: timestamp("bounced_at"),
  lastActivityAt: timestamp("last_activity_at"),
  deletedAt: timestamp("deleted_at"),
  // ── Marketing OS Sprint 2b extension column (additive, nullable) ──────
  companyId: varchar("company_id", { length: 36 }).references((): AnyPgColumn => companies.id, { onDelete: "set null" }),
  // ── Sprint 2o.0: soft reverse-link to marketing_prospects (no FK per HR4) ─
  originatedFromProspectId: varchar("originated_from_prospect_id", { length: 36 }),
  marketingConvertedAt: timestamp("marketing_converted_at"),
}, (table) => ({
  ccOrgBrandIdx:           index("cc_org_brand_idx").on(table.orgId, table.brandId),
  ccOrgBrandLifecycleIdx:  index("cc_org_brand_lifecycle_idx").on(table.orgId, table.brandId, table.lifecycleStage),
  ccOrgBrandLeadStatusIdx: index("cc_org_brand_lead_status_idx").on(table.orgId, table.brandId, table.leadStatus),
  ccOrgBrandDeletedIdx:    index("cc_org_brand_deleted_idx").on(table.orgId, table.brandId, table.deletedAt),
  ccOrgCompanyIdx:         index("client_contacts_company_idx").on(table.orgId, table.companyId),
  orgIdIdx:                index("idx_client_contacts_org_id").on(table.orgId),
}));

export const projects = pgTable("projects", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  clientId: varchar("client_id", { length: 36 })
    .notNull()
    .references(() => clients.id),
  name: text("name").notNull(),
  description: text("description"),
  status: projectStatusEnum("status").notNull().default("ACTIVE"),
  budgetHours: numeric("budget_hours", { precision: 10, scale: 2 }),
  startDate: date("start_date"),
  endDate: date("end_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_projects_org_id").on(table.orgId),
]);

export const projectMembers = pgTable("project_members", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  projectId: varchar("project_id", { length: 36 })
    .notNull()
    .references(() => projects.id),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  hourlyRate: numeric("hourly_rate", { precision: 10, scale: 2 }).notNull(),
  costRateHourly: numeric("cost_rate_hourly", { precision: 10, scale: 2 }).notNull().default("0"),
  role: text("role").default("MEMBER"),
}, (table) => [
  uniqueIndex("ux_project_members_proj_user").on(table.projectId, table.userId),
  index("idx_project_members_org_id").on(table.orgId),
  index("idx_project_members_project_id").on(table.projectId),
  index("idx_project_members_user_id").on(table.userId),
]);

export const projectServices = pgTable("project_services", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  projectId: varchar("project_id", { length: 36 })
    .notNull()
    .references(() => projects.id),
  serviceId: varchar("service_id", { length: 36 })
    .notNull()
    .references(() => services.id),
  rateOverride: numeric("rate_override", { precision: 10, scale: 2 }),
}, (table) => [
  index("idx_project_services_org_id").on(table.orgId),
  index("idx_project_services_project_id").on(table.projectId),
]);

export const projectServiceMembers = pgTable("project_service_members", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  projectId: varchar("project_id", { length: 36 }).notNull().references(() => projects.id),
  serviceId: varchar("service_id", { length: 36 }).notNull().references(() => services.id),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
  billRate: numeric("bill_rate", { precision: 10, scale: 2 }),
  costRate: numeric("cost_rate", { precision: 10, scale: 2 }),
  effectiveDate: date("effective_date"),
  endDate: date("end_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ux_psm_proj_svc_user_effective")
    .on(table.projectId, table.serviceId, table.userId, table.effectiveDate),
  index("psm_org_idx").on(table.orgId),
]);

export const services = pgTable("services", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  name: text("name").notNull(),
  description: text("description"),
  defaultRate: numeric("default_rate", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_services_org_id").on(table.orgId),
  // Partial unique on (org_id, lower(name)) WHERE is_active=true — prevents
  // duplicate active service names per org while allowing soft-deleted (is_active=false)
  // duplicates to coexist.
  uniqueIndex("uq_services_org_name")
    .on(table.orgId, sql`lower(${table.name})`)
    .where(sql`(is_active = true)`),
]);

export const timeEntries = pgTable("time_entries", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  projectId: varchar("project_id", { length: 36 })
    .notNull()
    .references(() => projects.id),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  date: date("date").notNull(),
  minutes: integer("minutes").notNull(),
  billable: boolean("billable").notNull().default(true),
  rate: numeric("rate", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  invoiced: boolean("invoiced").notNull().default(false),
  startTime: varchar("start_time", { length: 5 }),
  endTime: varchar("end_time", { length: 5 }),
  serviceId: varchar("service_id", { length: 36 }),
  invoiceLineId: varchar("invoice_line_id", { length: 36 }),
  costRateSnapshot: numeric("cost_rate_snapshot", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgStatusIdx: index("time_entries_org_status_idx").on(table.orgId, table.invoiced),
  projectOrgIdx: index("time_entries_project_org_idx").on(table.projectId, table.orgId),
  dateIdx: index("idx_time_entries_date").on(table.date),
  orgDateIdx: index("idx_time_entries_org_date").on(table.orgId, table.date),
  orgIdIdx: index("idx_time_entries_org_id").on(table.orgId),
  projectIdIdx: index("idx_time_entries_project_id").on(table.projectId),
  userIdIdx: index("idx_time_entries_user_id").on(table.userId),
}));

export function computeMinutesFromTimes(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startMins = sh * 60 + sm;
  let endMins = eh * 60 + em;
  if (endMins <= startMins) endMins += 24 * 60;
  return endMins - startMins;
}

export const invoices = pgTable("invoices", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  clientId: varchar("client_id", { length: 36 })
    .notNull()
    .references(() => clients.id),
  number: text("number").notNull(),
  status: invoiceStatusEnum("status").notNull().default("DRAFT"),
  issuedDate: date("issued_date").notNull(),
  dueDate: date("due_date").notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  exchangeRate: numeric("exchange_rate", { precision: 16, scale: 8 }).notNull().default("1"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  discountType: text("discount_type").notNull().default("NONE"),
  discountValue: numeric("discount_value", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  taxRate: numeric("tax_rate", { precision: 10, scale: 2 })
    .notNull()
    .default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  publicToken: varchar("public_token", { length: 64 }).unique(),
  notes: text("notes"),
  sourceEstimateId: varchar("source_estimate_id", { length: 36 }).references(() => estimates.id),
  lastReminderSentAt: timestamp("last_reminder_sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgNumberUnique: uniqueIndex("invoices_org_number_idx").on(table.orgId, table.number),
  orgStatusIdx: index("invoices_org_status_idx").on(table.orgId, table.status),
  clientIdIdx: index("idx_invoices_client_id").on(table.clientId),
  orgIdIdx: index("idx_invoices_org_id").on(table.orgId),
  statusIdx: index("idx_invoices_status").on(table.status),
}));

export const invoiceLines = pgTable("invoice_lines", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  invoiceId: varchar("invoice_id", { length: 36 })
    .notNull()
    .references(() => invoices.id),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
  unitRate: numeric("unit_rate", { precision: 10, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  timeEntryId: varchar("time_entry_id", { length: 36 }),
  sortOrder: integer("sort_order").notNull().default(0),
  isHeader: boolean("is_header").notNull().default(false),
}, (table) => [
  index("idx_invoice_lines_invoice_id").on(table.invoiceId),
  index("idx_invoice_lines_org_id").on(table.orgId),
]);

export const invoiceRevisions = pgTable("invoice_revisions", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  invoiceId: varchar("invoice_id", { length: 36 })
    .notNull()
    .references(() => invoices.id),
  revisionNumber: integer("revision_number").notNull().default(1),
  snapshot: jsonb("snapshot").notNull(),
  reason: text("reason"),
  createdByUserId: varchar("created_by_user_id", { length: 36 }).references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("invoice_revisions_invoice_rev_idx").on(t.invoiceId, t.revisionNumber),
  index("idx_invoice_revisions_invoice_id").on(t.invoiceId),
  index("idx_invoice_revisions_org_id").on(t.orgId),
]);

export const stripeEventStatusEnum = pgEnum("stripe_event_status", [
  "PROCESSED",
  "IGNORED",
  "FAILED",
]);

export const stripeEvents = pgTable("stripe_events", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id, { onDelete: "cascade" }),
  stripeEventId: text("stripe_event_id").notNull(),
  type: text("type").notNull(),
  livemode: boolean("livemode").notNull().default(false),
  created: integer("created").notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  status: stripeEventStatusEnum("status").notNull(),
  failureCode: text("failure_code"),
  failureDetail: text("failure_detail"),
}, (table) => ({
  orgStripeEventUnique: uniqueIndex("stripe_events_org_event_id_idx").on(table.orgId, table.stripeEventId),
  orgIdIdx: index("idx_stripe_events_org_id").on(table.orgId),
}));

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING", "CLEARED", "RECONCILED", "VOIDED", "REFUNDED",
]);

export const payments = pgTable("payments", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  invoiceId: varchar("invoice_id", { length: 36 })
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  date: date("date").notNull(),
  method: text("method").notNull(),
  provider: text("provider").notNull().default("MANUAL"),
  providerRef: text("provider_ref"),
  referenceNumber: text("reference_number"),
  status: paymentStatusEnum("status").notNull().default("CLEARED"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgStatusIdx: index("payments_org_status_idx").on(table.orgId, table.status),
  invoiceOrgIdx: index("payments_invoice_org_idx").on(table.invoiceId, table.orgId),
  invoiceIdIdx: index("idx_payments_invoice_id").on(table.invoiceId),
  orgIdIdx: index("idx_payments_org_id").on(table.orgId),
}));

export const outboxEmails = pgTable("outbox_emails", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  invoiceId: varchar("invoice_id", { length: 36 })
    .references(() => invoices.id),
  estimateId: varchar("estimate_id", { length: 36 })
    .references(() => estimates.id),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("PENDING"),
  sentAt: timestamp("sent_at"),
  failReason: text("fail_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_outbox_emails_org_id").on(table.orgId),
]);

export const timesheetStatusEnum = pgEnum("timesheet_status", [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
]);

export const timesheetWeeks = pgTable("timesheet_weeks", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  weekStartDate: date("week_start_date").notNull(),
  status: timesheetStatusEnum("status").notNull().default("DRAFT"),
  submittedAt: timestamp("submitted_at"),
  approvedAt: timestamp("approved_at"),
  approvedByUserId: varchar("approved_by_user_id", { length: 36 }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_timesheet_weeks_org_id").on(table.orgId),
  index("idx_timesheet_weeks_user_id").on(table.userId),
]);

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  userId: varchar("user_id", { length: 36 }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: varchar("entity_id", { length: 36 }),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("idx_audit_logs_org_id").on(table.orgId),
]);

export const importRunStatusEnum = pgEnum("import_run_status", [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "ROLLED_BACK",
  "FAILED",
]);

export const importRuns = pgTable("import_runs", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  createdBy: varchar("created_by", { length: 36 })
    .notNull()
    .references(() => users.id),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  status: importRunStatusEnum("status").notNull().default("PENDING"),
  optionsJson: jsonb("options_json"), // Freeform: mirrors ImportOptions interface from import-engine.ts
  summaryJson: jsonb("summary_json"), // Freeform: mirrors DryRunPlan summary object from import-engine.ts
  planHash: varchar("plan_hash", { length: 64 }),
}, (table) => [
  index("idx_import_runs_org_id").on(table.orgId),
]);

export const importFiles = pgTable("import_files", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  importRunId: varchar("import_run_id", { length: 36 })
    .notNull()
    .references(() => importRuns.id),
  type: text("type").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  originalFilename: text("original_filename").notNull(),
  storedPath: text("stored_path").notNull(),
}, (table) => [
  index("idx_import_files_import_run_id").on(table.importRunId),
  index("idx_import_files_org_id").on(table.orgId),
]);

export const importedKeys = pgTable("imported_keys", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  importRunId: varchar("import_run_id", { length: 36 })
    .notNull()
    .references(() => importRuns.id),
  entityType: text("entity_type").notNull(),
  externalKey: text("external_key").notNull(),
  entityId: varchar("entity_id", { length: 36 }).notNull(),
}, (table) => ({
  orgEntityKeyUnique: uniqueIndex("imported_keys_org_entity_key_idx").on(table.orgId, table.entityType, table.externalKey),
}));

export const importedPayouts = pgTable("imported_payouts", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  paidAt: date("paid_at").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  payeeName: text("payee_name").notNull(),
  payeeNormalized: text("payee_normalized").notNull(),
  merchant: text("merchant"),
  description: text("description"),
  source: text("source"),
  externalKey: text("external_key").notNull().unique(),
}, (table) => [
  index("idx_imported_payouts_org_id").on(table.orgId),
]);

export const insertImportedPayoutSchema = createInsertSchema(
  importedPayouts,
).omit({ id: true });
export type ImportedPayout = typeof importedPayouts.$inferSelect;
export type InsertImportedPayout = z.infer<
  typeof insertImportedPayoutSchema
>;

export const recurringFrequencyEnum = pgEnum("recurring_frequency", [
  "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY",
]);

export const teamMemberPayoutsV2 = pgTable("team_member_payouts_v2", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  teamMemberId: varchar("team_member_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  payoutDate: date("payout_date").notNull(),
  paymentMethod: text("payment_method").notNull(),
  referenceNumber: text("reference_number"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  notes: text("notes"),
  status: payoutStatusEnum("status").notNull().default("COMPLETED"),
  stripeTransferId: text("stripe_transfer_id"),
  stripeTransferStatus: text("stripe_transfer_status"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_team_member_payouts_v2_org_id").on(table.orgId),
]);

export const payoutTimeEntries = pgTable("payout_time_entries", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  payoutId: varchar("payout_id", { length: 36 })
    .notNull()
    .references(() => teamMemberPayoutsV2.id),
  timeEntryId: varchar("time_entry_id", { length: 36 })
    .notNull()
    .references(() => timeEntries.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
}, (table) => [
  index("idx_payout_time_entries_org_id").on(table.orgId),
  index("idx_payout_time_entries_payout_id").on(table.payoutId),
]);

export const recurringInvoiceTemplates = pgTable("recurring_invoice_templates", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  clientId: varchar("client_id", { length: 36 })
    .notNull()
    .references(() => clients.id),
  frequency: recurringFrequencyEnum("frequency").notNull(),
  dayOfMonth: integer("day_of_month"),
  nextIssueDate: date("next_issue_date").notNull(),
  templateLines: jsonb("template_lines").notNull(),
  discountType: text("discount_type").notNull().default("NONE"),
  discountValue: numeric("discount_value", { precision: 12, scale: 2 }).notNull().default("0"),
  taxRate: numeric("tax_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_recurring_invoice_templates_org_id").on(table.orgId),
]);

export const templateLineSchema = z.object({
  description: z.string(),
  quantity: z.union([z.number(), z.string()]),
  unitRate: z.union([z.number(), z.string()]),
  serviceId: z.string().optional(),
}).passthrough();

export const templateLinesSchema = z.array(templateLineSchema).max(500, "Cannot exceed 500 template lines");

export const insertRecurringTemplateSchema = createInsertSchema(recurringInvoiceTemplates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  templateLines: templateLinesSchema,
});
export type RecurringInvoiceTemplate = typeof recurringInvoiceTemplates.$inferSelect;
export type InsertRecurringTemplate = z.infer<typeof insertRecurringTemplateSchema>;

export const expenseStatusEnum = pgEnum("expense_status", [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "REIMBURSED",
]);

export const estimateStatusEnum = pgEnum("estimate_status", [
  "DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED", "INVOICED",
]);

export const estimates = pgTable("estimates", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  clientId: varchar("client_id", { length: 36 })
    .notNull()
    .references(() => clients.id),
  number: text("number").notNull(),
  status: estimateStatusEnum("status").notNull().default("DRAFT"),
  issuedDate: date("issued_date").notNull(),
  expiryDate: date("expiry_date"),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull().default("0"),
  discountType: text("discount_type").notNull().default("NONE"),
  discountValue: numeric("discount_value", { precision: 12, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  taxRate: numeric("tax_rate", { precision: 10, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  publicToken: varchar("public_token", { length: 64 }).unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgNumberUnique: uniqueIndex("estimates_org_number_idx").on(table.orgId, table.number),
  clientIdIdx: index("idx_estimates_client_id").on(table.clientId),
  orgIdIdx: index("idx_estimates_org_id").on(table.orgId),
}));

export const estimateLines = pgTable("estimate_lines", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  estimateId: varchar("estimate_id", { length: 36 })
    .notNull()
    .references(() => estimates.id),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 2 }).notNull(),
  unitRate: numeric("unit_rate", { precision: 10, scale: 2 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
}, (table) => [
  index("idx_estimate_lines_org_id").on(table.orgId),
]);

// ══════════════════════════════════════════════════════════════════
// EXPENSE MANAGEMENT
// ══════════════════════════════════════════════════════════════════

export const expenseCategories = pgTable("expense_categories", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  name: text("name").notNull(),
  glCode: text("gl_code"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  glAccountId: integer("gl_account_id").references(() => glAccounts.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_expense_categories_org_id").on(table.orgId),
]);

export const expenses = pgTable("expenses", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  categoryId: varchar("category_id", { length: 36 })
    .references(() => expenseCategories.id),
  reportId: varchar("report_id", { length: 36 }),
  // Currency
  currency: varchar("currency", { length: 3 }).notNull().default("USD"),
  exchangeRate: numeric("exchange_rate", { precision: 16, scale: 8 }).notNull().default("1"),
  amountInBaseCurrency: numeric("amount_in_base_currency", { precision: 12, scale: 2 }),
  // Core fields
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  date: date("date").notNull(),
  vendor: text("vendor"),
  description: text("description"),
  // Classification
  projectId: varchar("project_id", { length: 36 })
    .references(() => projects.id),
  clientId: varchar("client_id", { length: 36 })
    .references(() => clients.id),
  billable: boolean("billable").notNull().default(false),
  reimbursable: boolean("reimbursable").notNull().default(true),
  category: text("category"),
  // Receipt
  receiptUrl: text("receipt_url"),
  receiptFilename: text("receipt_filename"),
  additionalReceiptUrls: text("additional_receipt_urls"),
  // Status + approval
  status: expenseStatusEnum("status").notNull().default("DRAFT"),
  approvedByUserId: varchar("approved_by_user_id", { length: 36 }),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  // Invoice linkage (when billable expense is added to invoice)
  invoiceLineId: varchar("invoice_line_id", { length: 36 }),
  invoiced: boolean("invoiced").notNull().default(false),
  // Metadata
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_expenses_category_id").on(table.categoryId),
  index("idx_expenses_date").on(table.date),
  index("idx_expenses_org_id").on(table.orgId),
  index("idx_expenses_org_status").on(table.orgId, table.status),
  index("idx_expenses_report_id").on(table.reportId),
  index("idx_expenses_user_id").on(table.userId),
]);

export const expenseReports = pgTable("expense_reports", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  expenseCount: integer("expense_count").notNull().default(0),
  status: expenseStatusEnum("status").notNull().default("DRAFT"),
  submittedAt: timestamp("submitted_at"),
  approvedByUserId: varchar("approved_by_user_id", { length: 36 }),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  reimbursedAt: timestamp("reimbursed_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_expense_reports_org_id").on(table.orgId),
  index("idx_expense_reports_user_id").on(table.userId),
]);

export const exchangeRates = pgTable("exchange_rates", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 }),
  baseCurrency: varchar("base_currency", { length: 3 }).notNull(),
  targetCurrency: varchar("target_currency", { length: 3 }).notNull(),
  rate: numeric("rate", { precision: 16, scale: 8 }).notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

export const insertEstimateSchema = createInsertSchema(estimates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  total: true,
  subtotal: true,
  discountAmount: true,
  taxAmount: true,
  publicToken: true,
});
export const insertEstimateLineSchema = createInsertSchema(estimateLines).omit({
  id: true,
});
export type Estimate = typeof estimates.$inferSelect;
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type EstimateLine = typeof estimateLines.$inferSelect;
export type InsertEstimateLine = z.infer<typeof insertEstimateLineSchema>;

export const insertTeamMemberPayoutSchema = createInsertSchema(
  teamMemberPayoutsV2,
).omit({ id: true, createdAt: true,
  updatedAt: true });
export const insertPayoutTimeEntrySchema = createInsertSchema(
  payoutTimeEntries,
).omit({ id: true });
export type TeamMemberPayoutV2 = typeof teamMemberPayoutsV2.$inferSelect;
export type InsertTeamMemberPayoutV2 = z.infer<typeof insertTeamMemberPayoutSchema>;
export type PayoutTimeEntry = typeof payoutTimeEntries.$inferSelect;
export type InsertPayoutTimeEntry = z.infer<typeof insertPayoutTimeEntrySchema>;

export const insertImportRunSchema = createInsertSchema(importRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});
export const insertImportFileSchema = createInsertSchema(importFiles).omit({
  id: true,
});
export const insertImportedKeySchema = createInsertSchema(importedKeys).omit({
  id: true,
});

export type ImportRun = typeof importRuns.$inferSelect;
export type InsertImportRun = z.infer<typeof insertImportRunSchema>;
export type ImportFile = typeof importFiles.$inferSelect;
export type InsertImportFile = z.infer<typeof insertImportFileSchema>;
export type ImportedKey = typeof importedKeys.$inferSelect;
export type InsertImportedKey = z.infer<typeof insertImportedKeySchema>;

export const reminderDaysOverdueSchema = z.array(z.number().int().min(1).max(365));

export const insertOrgSchema = createInsertSchema(orgs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  reminderDaysOverdue: reminderDaysOverdueSchema.max(20, "Cannot exceed 20 reminder days").optional(),
});
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertClientSchema = createInsertSchema(clients).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertClientContactSchema = createInsertSchema(clientContacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertClientNoteSchema = createInsertSchema(clientNotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertClientActivitySchema = createInsertSchema(clientActivities).omit({
  id: true,
  createdAt: true,
});
export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertProjectMemberSchema = createInsertSchema(
  projectMembers,
).omit({ id: true });
export const insertServiceSchema = createInsertSchema(services).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  invoiced: true,
  invoiceLineId: true,
});
export const insertInvoiceSchema = createInsertSchema(invoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  total: true,
  paidAmount: true,
  subtotal: true,
  discountAmount: true,
  taxAmount: true,
  publicToken: true,
});
export const insertInvoiceLineSchema = createInsertSchema(invoiceLines).omit({
  id: true,
});
export const insertStripeEventSchema = createInsertSchema(stripeEvents).omit({
  id: true,
  receivedAt: true,
});
export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertOutboxEmailSchema = createInsertSchema(outboxEmails).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  sentAt: true,
  failReason: true,
});
export const insertTimesheetWeekSchema = createInsertSchema(
  timesheetWeeks,
).omit({ id: true, createdAt: true,
  updatedAt: true, submittedAt: true, approvedAt: true });
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});

export type Org = typeof orgs.$inferSelect;
export type InsertOrg = z.infer<typeof insertOrgSchema>;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type Client = typeof clients.$inferSelect;
export type InsertClient = z.infer<typeof insertClientSchema>;
export type ClientContact = typeof clientContacts.$inferSelect;
export type InsertClientContact = z.infer<typeof insertClientContactSchema>;
export type ClientNote = typeof clientNotes.$inferSelect;
export type InsertClientNote = z.infer<typeof insertClientNoteSchema>;
export type ClientActivity = typeof clientActivities.$inferSelect;
export type InsertClientActivity = z.infer<typeof insertClientActivitySchema>;
export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type ProjectMember = typeof projectMembers.$inferSelect;
export type InsertProjectMember = z.infer<typeof insertProjectMemberSchema>;
export type Service = typeof services.$inferSelect;
export type InsertService = z.infer<typeof insertServiceSchema>;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type Invoice = typeof invoices.$inferSelect;
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type InsertInvoiceLine = z.infer<typeof insertInvoiceLineSchema>;
export type InvoiceRevision = typeof invoiceRevisions.$inferSelect;
export type StripeEvent = typeof stripeEvents.$inferSelect;
export type InsertStripeEvent = z.infer<typeof insertStripeEventSchema>;
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type OutboxEmail = typeof outboxEmails.$inferSelect;
export type InsertOutboxEmail = z.infer<typeof insertOutboxEmailSchema>;
export type TimesheetWeek = typeof timesheetWeeks.$inferSelect;
export type InsertTimesheetWeek = z.infer<typeof insertTimesheetWeekSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

export const bulkOps = pgTable("bulk_ops", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  entity: text("entity").notNull(),
  action: text("action").notNull(),
  itemIds: jsonb("item_ids").notNull(),
  tag: text("tag"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  confirmedAt: timestamp("confirmed_at"),
  undoneAt: timestamp("undone_at"),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  index("idx_bulk_ops_org_status").on(table.orgId, table.status),
  index("idx_bulk_ops_expires")
    .on(table.expiresAt)
    .where(sql`expires_at IS NOT NULL`),
]);
export type BulkOp = typeof bulkOps.$inferSelect;

export const signupSchema = z.object({
  firmName: z.string().min(1, "Firm name is required").max(200, "Must be at most 200 characters"),
  firstName: z.string().min(1, "First name is required").max(100, "Must be at most 100 characters"),
  lastName: z.string().min(1, "Last name is required").max(100, "Must be at most 100 characters"),
  email: z.string().email("Valid email is required").max(200, "Must be at most 200 characters"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200, "Must be at most 200 characters").regex(/[A-Z]/, "Must contain uppercase").regex(/[a-z]/, "Must contain lowercase").regex(/[0-9]/, "Must contain a number"),
  plan: z.enum(["STARTER", "PROFESSIONAL", "BUSINESS"]).optional().default("PROFESSIONAL"),
  annual: z.boolean().optional().default(false),
});

export const loginSchema = z.object({
  orgSlug: z.string().min(1).max(100).optional(),
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createClientSchema = z.object({
  name: z.string().min(1, "Name is required").max(200, "Must be at most 200 characters"),
  email: z.string().email().max(200, "Must be at most 200 characters").nullable().optional(),
  phone: z.string().max(200, "Must be at most 200 characters").nullable().optional(),
  address: z.string().max(5000, "Must be at most 5000 characters").nullable().optional(),
  website: z.string().max(2000, "Must be at most 2000 characters").nullable().optional(),
  currency: z.string().length(3).optional(),
});

export const createProjectSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  name: z.string().min(1, "Name is required").max(200, "Must be at most 200 characters"),
  description: z.string().max(5000, "Must be at most 5000 characters").nullable().optional(),
  budgetHours: z.coerce.number().nonnegative().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export const addProjectMemberSchema = z.object({
  userId: z.string().min(1, "Team member is required"),
  billRate: z.coerce.number().positive("Rate must be positive").max(10000, "Rate cannot exceed $10,000/hr").optional(),
  costRate: z.coerce.number().nonnegative("Cost rate must be >= 0").max(10000, "Cost rate cannot exceed $10,000/hr").optional(),
  hourlyRate: z.coerce.number().positive("Rate must be positive").max(10000, "Rate cannot exceed $10,000/hr").optional(),
  costRateHourly: z.coerce.number().nonnegative("Cost rate must be >= 0").max(10000, "Cost rate cannot exceed $10,000/hr").optional(),
}).transform((data) => ({
  userId: data.userId,
  hourlyRate: data.billRate ?? data.hourlyRate ?? 0,
  costRateHourly: data.costRate ?? data.costRateHourly ?? 0,
}));

const dateString = z.string().min(1, "Date is required").refine((val) => {
  const d = new Date(val);
  return !isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100;
}, { message: "Invalid date format or out of range" });

export const createTimeEntrySchema = z.object({
  projectId: z.string().min(1, "Project is required"),
  date: dateString,
  minutes: z.coerce.number().int().positive("Minutes must be positive").max(1440, "Cannot exceed 24 hours").optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM format").optional().nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM format").optional().nullable(),
  billable: z.boolean().default(true),
  rate: z.coerce.number().nonnegative().optional(),
  serviceId: z.string().nullable().optional(),
  notes: z.string().min(1, "Description is required").max(5000, "Must be at most 5000 characters"),
}).refine(data => {
  if (data.minutes && data.minutes > 0) return true;
  if (data.startTime && data.endTime) return true;
  return false;
}, { message: "Provide either duration or start/end time" }).refine(data => {
  const entryDate = new Date(data.date);
  const now = new Date();
  return entryDate.getTime() <= now.getTime() + 86400000;
}, { message: "Cannot submit time for future dates" }).refine(data => {
  const entryDate = new Date(data.date);
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  return entryDate >= oneYearAgo;
}, { message: "Cannot submit time more than 1 year in the past" });

export const generateInvoiceSchema = z.object({
  clientId: z.string().min(1, "Client is required"),
  dueDate: z.string().optional(),
  teamMemberIds: z.array(z.string()).max(100, "Cannot exceed 100 team members").optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  grouping: z.enum(["combined", "per-team-member"]).optional().default("combined"),
  includeUnapproved: z.boolean().optional(),
  lineGroupBy: z.enum(["team-member", "project", "service", "none"]).optional().default("team-member"),
  currency: z.string().length(3).optional(),
  exchangeRate: z.string().optional(),
});

export const createPaymentSchema = z.object({
  invoiceId: z.string().min(1, "Invoice is required"),
  amount: z.coerce.number().positive("Amount must be positive").max(999_999_999.99, "Amount exceeds maximum ($999,999,999.99)"),
  date: dateString,
  method: z.string().min(1, "Payment method is required").max(200, "Must be at most 200 characters"),
  referenceNumber: z.string().max(200, "Must be at most 200 characters").nullable().optional(),
  notes: z.string().max(5000, "Must be at most 5000 characters").nullable().optional(),
});

const MAX_INVOICE_AMOUNT = 999_999_999.99;

export const addInvoiceLineSchema = z.object({
  description: z.string().min(1, "Description is required").max(5000, "Must be at most 5000 characters"),
  quantity: z.coerce.number().min(0, "Quantity must be >= 0").max(MAX_INVOICE_AMOUNT, "Quantity exceeds maximum"),
  unitRate: z.coerce.number().min(0, "Rate must be >= 0").max(MAX_INVOICE_AMOUNT, "Rate exceeds maximum ($999,999,999.99)"),
  type: z.string().optional(),
}).refine(data => {
  if (data.type === "header") return true;
  return data.quantity > 0;
}, { message: "Quantity must be greater than 0 for non-header line items" });

export const updateInvoiceLineSchema = z.object({
  description: z.string().min(1, "Description is required").max(5000, "Must be at most 5000 characters"),
  quantity: z.coerce.number().min(0, "Quantity must be >= 0").max(MAX_INVOICE_AMOUNT, "Quantity exceeds maximum"),
  unitRate: z.coerce.number().min(0, "Rate must be >= 0").max(MAX_INVOICE_AMOUNT, "Rate exceeds maximum ($999,999,999.99)"),
});

export const updateInvoiceSchema = z.object({
  discountType: z.enum(["NONE", "PERCENT", "FIXED"]).optional(),
  discountValue: z.coerce.number().min(0, "Discount must be >= 0").max(MAX_INVOICE_AMOUNT, "Discount exceeds maximum").optional(),
  taxRate: z.coerce.number().min(0, "Tax rate must be >= 0").max(100, "Tax rate must be 0-100").optional(),
  notes: z.string().max(5000, "Must be at most 5000 characters").nullable().optional(),
  currency: z.string().length(3).optional(),
  exchangeRate: z.string().optional(),
});

export const createPayoutSchema = z.object({
  teamMemberId: z.string().min(1, "Team member is required"),
  amount: z.coerce.number().positive("Amount must be positive"),
  payoutDate: z.string().min(1, "Payout date is required"),
  paymentMethod: z.string().min(1, "Payment method is required").max(200, "Must be at most 200 characters"),
  referenceNumber: z.string().max(200, "Must be at most 200 characters").nullable().optional(),
  periodStart: z.string().nullable().optional(),
  periodEnd: z.string().nullable().optional(),
  notes: z.string().max(5000, "Must be at most 5000 characters").nullable().optional(),
  status: z.enum(["PENDING", "COMPLETED", "VOID"]).optional().default("COMPLETED"),
  timeEntryIds: z.array(z.string()).max(1000, "Cannot exceed 1000 entries").optional(),
});

// ── Expense insert schemas ──
export const insertExpenseCategorySchema = createInsertSchema(expenseCategories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertExpenseSchema = createInsertSchema(expenses).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
  approvedByUserId: true,
  invoiceLineId: true,
  invoiced: true,
});

export const insertExpenseReportSchema = createInsertSchema(expenseReports).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  approvedAt: true,
  approvedByUserId: true,
  reimbursedAt: true,
  totalAmount: true,
  expenseCount: true,
});

export type ExpenseCategory = typeof expenseCategories.$inferSelect;
export type InsertExpenseCategory = z.infer<typeof insertExpenseCategorySchema>;
export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type ExpenseReport = typeof expenseReports.$inferSelect;
export type InsertExpenseReport = z.infer<typeof insertExpenseReportSchema>;

export const createExpenseSchema = z.object({
  amount: z.string().or(z.number()).refine(val => Number(val) > 0, { message: "Amount must be greater than zero" }),
  currency: z.string().length(3).optional(),
  date: dateString,
  vendor: z.string().max(200, "Must be at most 200 characters").optional(),
  description: z.string().max(5000, "Must be at most 5000 characters").optional(),
  categoryId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  billable: z.boolean().optional().default(false),
  reimbursable: z.boolean().optional().default(true),
  receiptUrl: z.string().max(2000, "Must be at most 2000 characters").nullable().optional(),
  receiptFilename: z.string().max(200, "Must be at most 200 characters").nullable().optional(),
  additionalReceiptUrls: z.string().max(10000, "Must be at most 10000 characters").nullable().optional(),
  notes: z.string().max(5000, "Must be at most 5000 characters").nullable().optional(),
  reportId: z.string().nullable().optional(),
});

export const createExpenseReportSchema = z.object({
  title: z.string().min(1).max(200, "Must be at most 200 characters"),
  description: z.string().max(5000, "Must be at most 5000 characters").optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  expenseIds: z.array(z.string()).max(1000, "Cannot exceed 1000 expenses").optional(),
  notes: z.string().max(5000, "Must be at most 5000 characters").nullable().optional(),
});

export function getWeekStartDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().split("T")[0];
}

export function getWeekEndDate(weekStartDate: string): string {
  const d = new Date(weekStartDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().split("T")[0];
}

export function computeUtilization(
  billableMinutes: number,
  nonBillableMinutes: number,
): number {
  const total = billableMinutes + nonBillableMinutes;
  if (total === 0) return 0;
  return Math.round((billableMinutes / total) * 10000) / 10000;
}

export const submitTimesheetSchema = z.object({
  weekStartDate: z.string().min(1),
  confirmEmpty: z.boolean().optional(),
  /**
   * Optional. When set, the caller is submitting on behalf of another rep
   * who forgot to. Server requires the caller to be MANAGER or ADMIN and
   * the target to belong to the same org; otherwise the field is ignored
   * and the caller's own userId is used.
   */
  targetUserId: z.string().uuid().optional(),
});

export const rejectTimesheetSchema = z.object({
  reason: z.string().min(1, "Rejection reason is required"),
});

export const unlockTimesheetSchema = z.object({
  reason: z.string().min(1, "Unlock reason is required"),
});

export const unlockExpenseReportSchema = z.object({
  reason: z.string().min(1, "Unlock reason is required"),
});

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

export function getAgingBucket(ageDays: number): AgingBucket {
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  return "90+";
}

export function computeProfitability(revenue: number, cost: number) {
  const profit = round2(revenue - cost);
  const margin = revenue === 0 ? (cost > 0 ? -1 : 0) : round4(profit / revenue);
  return { revenue: round2(revenue), cost: round2(cost), profit, margin };
}

// taxCalculationMode controls tax computation order for jurisdictional differences:
// - "tax_after_discount" (default): tax is computed on (subtotal - discount). Used in most US/UK jurisdictions.
// - "tax_before_discount": tax is computed on subtotal before discount is subtracted. Used in some EU/LATAM jurisdictions
//   where tax applies to the gross amount and discounts are treated as post-tax reductions.
export function computeInvoiceTotals(
  lines: { amount: string | number }[],
  discountType: string,
  discountValue: number,
  taxRate: number,
  taxCalculationMode: string = "tax_after_discount",
) {
  const subtotal = round2(
    lines.reduce((sum, l) => sum + Number(l.amount), 0),
  );

  let discountAmount = 0;
  if (discountType === "PERCENT") {
    discountAmount = round2(subtotal * discountValue / 100);
  } else if (discountType === "FIXED") {
    discountAmount = round2(discountValue);
  }
  if (discountAmount > subtotal) {
    discountAmount = subtotal;
  }

  let taxAmount: number;
  let total: number;

  if (taxCalculationMode === "tax_before_discount") {
    taxAmount = round2(subtotal * taxRate / 100);
    total = round2(subtotal + taxAmount - discountAmount);
  } else {
    const taxableBase = round2(subtotal - discountAmount);
    taxAmount = round2(taxableBase * taxRate / 100);
    total = round2(taxableBase + taxAmount);
  }

  return { subtotal, discountAmount, taxAmount, total };
}

export const bankConnectionStatusEnum = pgEnum("bank_connection_status", [
  "ACTIVE",
  "DISCONNECTED",
  "ERROR",
]);

export const bankTransactionStatusEnum = pgEnum("bank_transaction_status", [
  "PENDING",
  "MATCHED",
  "RECONCILED",
  "IGNORED",
]);

export const bankMatchEntityTypeEnum = pgEnum("bank_match_entity_type", [
  "INVOICE_PAYMENT",
  "PAYOUT",
  "EXPENSE",
  "JOURNAL_ENTRY",
]);

export const bankMatchTypeEnum = pgEnum("bank_match_type", [
  "AUTO_PERFECT",
  "AUTO_FUZZY",
  "MANUAL",
]);

export const bankConnections = pgTable("bank_connections", {
  // serial: internal-only banking table, no cross-table UUID joins needed
  id: serial("id").primaryKey(),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  stripeAccountId: varchar("stripe_account_id", { length: 255 }).notNull(),
  institutionName: varchar("institution_name", { length: 255 }).notNull(),
  accountName: varchar("account_name", { length: 255 }),
  accountType: varchar("account_type", { length: 50 }),
  last4: varchar("last4", { length: 4 }),
  status: bankConnectionStatusEnum("status").default("ACTIVE").notNull(),
  accessToken: text("access_token"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_bank_connections_org_id").on(table.orgId),
]);

export const insertBankConnectionSchema = createInsertSchema(bankConnections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBankConnection = z.infer<typeof insertBankConnectionSchema>;
export type BankConnection = typeof bankConnections.$inferSelect;

export const bankTransactions = pgTable("bank_transactions", {
  // serial: internal-only banking table, referenced only by bankTransactionMatches via integer FK
  id: serial("id").primaryKey(),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  bankConnectionId: integer("bank_connection_id").notNull().references(() => bankConnections.id),
  stripeTransactionId: varchar("stripe_transaction_id", { length: 255 }),
  date: date("date").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 100 }),
  status: bankTransactionStatusEnum("status").default("PENDING").notNull(),
  matchedEntityType: varchar("matched_entity_type", { length: 50 }),
  matchedEntityId: varchar("matched_entity_id", { length: 36 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_bank_transactions_org_id").on(table.orgId),
]);

export const insertBankTransactionSchema = createInsertSchema(bankTransactions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBankTransaction = z.infer<typeof insertBankTransactionSchema>;
export type BankTransaction = typeof bankTransactions.$inferSelect;

export const bankTransactionMatches = pgTable("bank_transaction_matches", {
  // serial: internal-only banking match table, no cross-table UUID joins needed
  id: serial("id").primaryKey(),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  // FK explicit-named below to avoid PG's 63-char truncation loop.
  bankTransactionId: integer("bank_transaction_id").notNull(),
  entityType: bankMatchEntityTypeEnum("entity_type").notNull(),
  entityId: varchar("entity_id", { length: 36 }).notNull(),
  matchType: bankMatchTypeEnum("match_type").notNull(),
  confidence: numeric("confidence", { precision: 5, scale: 2 }),
  matchedBy: varchar("matched_by", { length: 36 }).references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  foreignKey({
    columns: [table.bankTransactionId],
    foreignColumns: [bankTransactions.id],
    name: "bank_transaction_matches_bank_transaction_id_bank_transactions_",
  }),
  index("idx_bank_transaction_matches_org_id").on(table.orgId),
]);

export const insertBankTransactionMatchSchema = createInsertSchema(bankTransactionMatches).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertBankTransactionMatch = z.infer<typeof insertBankTransactionMatchSchema>;
export type BankTransactionMatch = typeof bankTransactionMatches.$inferSelect;

export const bankReconciliationLogs = pgTable("bank_reconciliation_logs", {
  // serial: internal-only reconciliation log, no cross-table UUID joins needed
  id: serial("id").primaryKey(),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  // FK explicit-named below to avoid PG's 63-char truncation loop.
  bankConnectionId: integer("bank_connection_id"),
  reconciledAt: timestamp("reconciled_at").defaultNow().notNull(),
  totalTransactions: integer("total_transactions").notNull(),
  matchedCount: integer("matched_count").notNull(),
  unmatchedCount: integer("unmatched_count").notNull(),
  reconciledBy: varchar("reconciled_by", { length: 36 }).references(() => users.id),
}, (table) => [
  foreignKey({
    columns: [table.bankConnectionId],
    foreignColumns: [bankConnections.id],
    name: "bank_reconciliation_logs_bank_connection_id_bank_connections_id",
  }),
  index("idx_bank_reconciliation_logs_org_id").on(table.orgId),
]);

export const insertBankReconciliationLogSchema = createInsertSchema(bankReconciliationLogs).omit({
  id: true,
  reconciledAt: true,
});
export type InsertBankReconciliationLog = z.infer<typeof insertBankReconciliationLogSchema>;
export type BankReconciliationLog = typeof bankReconciliationLogs.$inferSelect;

export const glAccounts = pgTable("gl_accounts", {
  // serial: internal-only GL account table, referenced by glJournalLines via integer FK
  id: serial("id").primaryKey(),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  accountNumber: varchar("account_number", { length: 20 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  accountType: glAccountTypeEnum("account_type").notNull(),
  parentAccountId: integer("parent_account_id"),
  description: text("description"),
  isSystem: boolean("is_system").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  normalBalance: varchar("normal_balance", { length: 10 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("USD").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_gl_accounts_org_account_number").on(table.orgId, table.accountNumber),
  index("idx_gl_accounts_org_id").on(table.orgId),
]);

export const insertGlAccountSchema = createInsertSchema(glAccounts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGlAccount = z.infer<typeof insertGlAccountSchema>;
export type GlAccount = typeof glAccounts.$inferSelect;

export const glJournalEntries = pgTable("gl_journal_entries", {
  // serial: internal-only GL journal table, referenced by glJournalLines via integer FK
  id: serial("id").primaryKey(),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  entryDate: date("entry_date").notNull(),
  memo: text("memo"),
  sourceType: varchar("source_type", { length: 50 }),
  sourceId: integer("source_id"),
  sourceRef: varchar("source_ref", { length: 64 }),
  isAutoGenerated: boolean("is_auto_generated").default(true).notNull(),
  isReversing: boolean("is_reversing").default(false).notNull(),
  reversedEntryId: integer("reversed_entry_id"),
  isOwnerPrivate: boolean("is_owner_private").default(false).notNull(),
  createdByUserId: varchar("created_by_user_id", { length: 36 }).references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_gl_journal_entries_org_id").on(table.orgId),
]);

export const insertGlJournalEntrySchema = createInsertSchema(glJournalEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGlJournalEntry = z.infer<typeof insertGlJournalEntrySchema>;
export type GlJournalEntry = typeof glJournalEntries.$inferSelect;

export const glJournalLines = pgTable("gl_journal_lines", {
  // serial: internal-only GL line item table, no cross-table UUID joins needed
  id: serial("id").primaryKey(),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  journalEntryId: integer("journal_entry_id").notNull().references(() => glJournalEntries.id, { onDelete: "cascade" }),
  accountId: integer("account_id").notNull().references(() => glAccounts.id, { onDelete: "restrict" }),
  debit: numeric("debit", { precision: 15, scale: 2 }).default("0").notNull(),
  credit: numeric("credit", { precision: 15, scale: 2 }).default("0").notNull(),
  memo: text("memo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_gl_journal_lines_account_id").on(table.accountId),
  index("idx_gl_journal_lines_journal_entry_id").on(table.journalEntryId),
  index("idx_gl_journal_lines_org_id").on(table.orgId),
]);

export const insertGlJournalLineSchema = createInsertSchema(glJournalLines).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGlJournalLine = z.infer<typeof insertGlJournalLineSchema>;
export type GlJournalLine = typeof glJournalLines.$inferSelect;

export const supportRequests = pgTable("support_requests", {
  // serial: internal-only support ticket table, no cross-table UUID joins needed
  id: serial("id").primaryKey(),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
  referenceId: varchar("reference_id", { length: 20 }).notNull(),
  userName: varchar("user_name", { length: 255 }).notNull(),
  userEmail: varchar("user_email", { length: 255 }).notNull(),
  orgName: varchar("org_name", { length: 255 }),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  pageUrl: text("page_url"),
  searchHistory: text("search_history"),
  emailSent: boolean("email_sent").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_support_requests_org_id").on(table.orgId),
  index("idx_support_requests_user_id").on(table.userId),
]);

export const insertSupportRequestSchema = createInsertSchema(supportRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertSupportRequest = z.infer<typeof insertSupportRequestSchema>;
export type SupportRequest = typeof supportRequests.$inferSelect;

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed",
]);

export const apiKeys = pgTable("api_keys", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  permissions: jsonb("permissions").notNull().default(sql`'["read"]'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdBy: varchar("created_by", { length: 36 })
    .notNull()
    .references(() => users.id),
}, (table) => [
  index("idx_api_keys_key_prefix").on(table.keyPrefix),
  index("idx_api_keys_org_id").on(table.orgId),
]);

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastUsedAt: true,
});
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeys.$inferSelect;

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").notNull().default(sql`'[]'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  description: text("description"),
  lastDeliveryAt: timestamp("last_delivery_at"),
  lastDeliveryStatus: text("last_delivery_status"),
  dnsConsecutiveFailures: integer("dns_consecutive_failures").notNull().default(0),
  oldSecret: text("old_secret"),
  secretRotatedAt: timestamp("secret_rotated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_webhook_endpoints_org_id").on(table.orgId),
]);

export const insertWebhookEndpointSchema = createInsertSchema(webhookEndpoints).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastDeliveryAt: true,
  lastDeliveryStatus: true,
});
export type InsertWebhookEndpoint = z.infer<typeof insertWebhookEndpointSchema>;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  webhookEndpointId: varchar("webhook_endpoint_id", { length: 36 })
    .notNull()
    .references(() => webhookEndpoints.id),
  event: text("event").notNull(),
  payload: jsonb("payload").notNull(),
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  deliveredAt: timestamp("delivered_at"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(4),
  nextRetryAt: timestamp("next_retry_at"),
  status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
  lastErrorType: varchar("last_error_type", { length: 30 }),
  idempotencyKey: varchar("idempotency_key", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("idx_webhook_deliveries_endpoint_id").on(table.webhookEndpointId),
  index("idx_webhook_deliveries_org_id").on(table.orgId),
  index("idx_webhook_deliveries_org_status").on(table.orgId, table.status),
]);

export const insertWebhookDeliverySchema = createInsertSchema(webhookDeliveries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deliveredAt: true,
  statusCode: true,
  responseBody: true,
});
export type InsertWebhookDelivery = z.infer<typeof insertWebhookDeliverySchema>;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

export const newsletterSubscribers = pgTable("newsletter_subscribers", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  orgId: varchar("org_id", { length: 36 }),
  subscribedAt: timestamp("subscribed_at").defaultNow().notNull(),
});

export const insertNewsletterSubscriberSchema = createInsertSchema(newsletterSubscribers).omit({
  id: true,
  subscribedAt: true,
});
export type InsertNewsletterSubscriber = z.infer<typeof insertNewsletterSubscriberSchema>;
export type NewsletterSubscriber = typeof newsletterSubscribers.$inferSelect;

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

export const closePeriods = pgTable("close_periods", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  status: text("status").notNull().default("OPEN"),
  closedAt: timestamp("closed_at"),
  closedByUserId: varchar("closed_by_user_id", { length: 36 })
    .references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("close_periods_org_period_idx").on(table.orgId, table.periodStart, table.periodEnd),
]);

export const activeSessions = pgTable("active_sessions", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
  userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
  sessionId: text("session_id").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  deviceLabel: text("device_label"),
  city: text("city"),
  lastActiveAt: timestamp("last_active_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("idx_active_sessions_session_uniq").on(table.sessionId),
  index("idx_active_sessions_user").on(table.userId),
]);

export type ActiveSession = typeof activeSessions.$inferSelect;

export const notificationPreferences = pgTable("notification_preferences", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  invoiceAlerts: boolean("invoice_alerts").default(true).notNull(),
  timesheetReminders: boolean("timesheet_reminders").default(true).notNull(),
  approvalNotifications: boolean("approval_notifications").default(true).notNull(),
  systemUpdates: boolean("system_updates").default(true).notNull(),
  marketingTips: boolean("marketing_tips").default(false).notNull(),
  mailboxAlerts: boolean("mailbox_alerts").default(true).notNull(),
  // Task #303 — Quiet-hours window. When enabled, non-urgent admin
  // failure emails (campaign digests, sequence-step exhaustion) are
  // buffered until `quietHoursEnd` (interpreted in `quietHoursTimezone`)
  // and then released. Mailbox-reconnect alerts deliberately bypass
  // this gate because they're action-required.
  quietHoursEnabled: boolean("quiet_hours_enabled").default(false).notNull(),
  // "HH:MM" 24h, e.g. "22:00". Wraps over midnight when start > end.
  quietHoursStart: text("quiet_hours_start").default("22:00").notNull(),
  quietHoursEnd: text("quiet_hours_end").default("07:00").notNull(),
  // IANA zone name, e.g. "America/Los_Angeles". Defaults to UTC so the
  // window means the same thing on every host without configuration.
  quietHoursTimezone: text("quiet_hours_timezone").default("UTC").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("notification_prefs_user_org_idx").on(table.userId, table.orgId),
]);

export const insertNotificationPreferencesSchema = createInsertSchema(notificationPreferences).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertNotificationPreferences = z.infer<typeof insertNotificationPreferencesSchema>;
export type NotificationPreferences = typeof notificationPreferences.$inferSelect;

/**
 * Task #303 — Buffer for admin failure emails that arrive during a
 * recipient's quiet-hours window. A periodic processor flushes rows
 * whose `releaseAt` has passed. Self-contained: each row carries the
 * fully-rendered subject/html/text so the worker doesn't need to
 * re-resolve the originating campaign or sequence step (which may
 * have been mutated in the meantime).
 */
export const pendingAdminNotifications = pgTable("pending_admin_notifications", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  bodyText: text("body_text").notNull(),
  contextTag: text("context_tag").notNull(),
  releaseAt: timestamp("release_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("pending_admin_notifications_release_at_idx").on(table.releaseAt),
]);

export type PendingAdminNotification = typeof pendingAdminNotifications.$inferSelect;

export const WEBHOOK_EVENT_TYPES = [
  "invoice.created",
  "invoice.sent",
  "invoice.paid",
  "invoice.voided",
  "payment.received",
  "payment.refunded",
  "client.created",
  "client.updated",
  "client.deleted",
  "project.created",
  "project.updated",
  "estimate.created",
  "estimate.sent",
  "estimate.accepted",
  "expense.created",
  "expense.approved",
  "time_entry.created",
  "time_entry.updated",
  "timesheet.submitted",
  "timesheet.approved",
  "timesheet.recalled",
  "payout.created",
  "payout.completed",
  "ping",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const inboundEmails = pgTable("inbound_emails", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  from: text("from_address").notNull(),
  to: text("to_address").notNull(),
  subject: text("subject"),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  headers: jsonb("headers"),
  resendMessageId: varchar("resend_message_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertInboundEmailSchema = createInsertSchema(inboundEmails).omit({
  id: true,
  createdAt: true,
});
export type InboundEmail = typeof inboundEmails.$inferSelect;
export type InsertInboundEmail = z.infer<typeof insertInboundEmailSchema>;

export const inviteStatusEnum = pgEnum("invite_status", [
  "PENDING",
  "ACCEPTED",
  "REVOKED",
  "EXPIRED",
]);

export const pendingInvites = pgTable("pending_invites", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  orgId: varchar("org_id", { length: 36 })
    .notNull()
    .references(() => orgs.id),
  email: varchar("email", { length: 255 }).notNull(),
  firstName: varchar("first_name", { length: 255 }).notNull(),
  lastName: varchar("last_name", { length: 255 }),
  role: roleEnum("role").notNull().default("TEAM_MEMBER"),
  invitedByUserId: varchar("invited_by_user_id", { length: 36 })
    .notNull()
    .references(() => users.id),
  inviteToken: varchar("invite_token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  status: inviteStatusEnum("status").notNull().default("PENDING"),
  lastResentAt: timestamp("last_resent_at"),
  resendCount: integer("resend_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("pending_invites_org_idx").on(table.orgId),
  index("pending_invites_token_idx").on(table.inviteToken),
  index("pending_invites_email_org_idx").on(table.email, table.orgId),
]);

export const insertPendingInviteSchema = createInsertSchema(pendingInvites).omit({
  id: true,
  createdAt: true,
  lastResentAt: true,
  resendCount: true,
});
export type PendingInvite = typeof pendingInvites.$inferSelect;
export type InsertPendingInvite = z.infer<typeof insertPendingInviteSchema>;

// ============================================================================
// Marketing OS — Sprint 1: Brands
// Gated at runtime by MARKETING_OS_ENABLED / VITE_MARKETING_OS_ENABLED.
// Schema is always present (push-safe) but no code path reads it when the
// flag is unset.
// ============================================================================
export const brands = pgTable(
  "brands",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 })
      .notNull()
      .references(() => orgs.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logoUrl: text("logo_url"),
    primaryColor: text("primary_color"),
    domain: text("domain"),
    fromEmail: text("from_email"),
    fromName: text("from_name"),
    replyTo: text("reply_to"),
    signatureHtml: text("signature_html"),
    active: boolean("active").notNull().default(true),
    // Sprint M-Chat-1 — additive, nullable per-brand chat config columns.
    // chat_enabled gates whether /api/marketing/chat answers for this brand
    // (along with the MARKETING_OS_ENABLED feature flag and the org-level
    // marketing_os entitlement). chat_persona_name / chat_welcome_message
    // are surfaced by the embed bubble. chat_system_prompt overrides the
    // curated knowledge file in server/marketing/chat-knowledge/ when set.
    // All four are nullable / default-false to keep this column-add safe
    // for the existing brands rows created via db:push pre-MChat-1.
    chatEnabled: boolean("chat_enabled").default(false),
    chatPersonaName: text("chat_persona_name"),
    chatWelcomeMessage: text("chat_welcome_message"),
    chatSystemPrompt: text("chat_system_prompt"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    brandsOrgSlugIdx: uniqueIndex("brands_org_slug_idx").on(table.orgId, table.slug),
    brandsOrgIdIdx: index("brands_org_id_idx").on(table.orgId),
  }),
);

export const insertBrandSchema = createInsertSchema(brands).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Brand = typeof brands.$inferSelect;
export type InsertBrand = z.infer<typeof insertBrandSchema>;

/**
 * Brand list row with per-brand usage stats joined in by
 * `storage.listBrandsByOrg`. `contactCount` is the number of non-deleted
 * `client_contacts` rows attributed to the brand. `lastSentAt` is the
 * most recent `contact_activities.occurred_at` for an `email_sent` /
 * `email_manual` activity scoped to the brand, or null if none.
 */
export type BrandWithStats = Brand & {
  contactCount: number;
  lastSentAt: Date | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Marketing OS — Sprint 2a: Contacts foundation
// New tables. Extension columns on clientContacts and clients are inline
// on those tables above. Everything is gated at the route+UI layer via
// MARKETING_OS_ENABLED / VITE_MARKETING_OS_ENABLED — the schema itself is
// always present (no schema feature-flag).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Brand-scoped contact tags. Tags are isolated per brand by design — "VIP"
 * in Brand A is a different tag from "VIP" in Brand B. Unique constraint
 * on (orgId, brandId, name) enforces this in SQL.
 */
export const contactTags = pgTable(
  "contact_tags",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    brandId: varchar("brand_id", { length: 36 }).notNull().references(() => brands.id),
    name: text("name").notNull(),
    color: text("color").notNull().default("#C41E3A"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    contactTagsOrgBrandNameUniq: uniqueIndex("contact_tags_org_brand_name_uniq").on(table.orgId, table.brandId, table.name),
    contactTagsOrgBrandIdx:      index("contact_tags_org_brand_idx").on(table.orgId, table.brandId),
  }),
);

/**
 * Many-to-many join between contacts and tags. ON DELETE CASCADE on both
 * sides so deleting a contact or a tag cleans up assignments automatically.
 */
export const contactTagAssignments = pgTable(
  "contact_tag_assignments",
  {
    // Sprint 2o.0 Step 5b1a — promoted to NOT NULL alongside the
    // composite PK swap to (prospect_id, tag_id). Safe because the
    // table is empty post Step 5a TRUNCATE.
    prospectId: varchar("prospect_id", { length: 36 })
      .notNull()
      .references(() => marketingProspects.id, { onDelete: "cascade" }),
    tagId: varchar("tag_id", { length: 36 })
      .notNull()
      .references(() => contactTags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // Sprint 2o.0 Step 5b1a — PK flipped from (contact_id, tag_id) to
    // (prospect_id, tag_id). End-state shape; 5b2 just drops contact_id.
    pk: primaryKey({ name: "contact_tag_assignments_prospect_id_tag_id_pk", columns: [table.prospectId, table.tagId] }),
    contactTagAssignmentsTagIdx: index("contact_tag_assignments_tag_idx").on(table.tagId),
    contactTagAssignmentsProspectIdx: index("contact_tag_assignments_prospect_idx").on(table.prospectId),
  }),
);

/**
 * Unified activity timeline per contact. Marketing events now; ops + sales
 * events later. The `payload jsonb` column keeps the schema open — adding
 * a new event type (e.g., 'sms_sent', 'invoice_sent') requires zero
 * migration. `type` is text (not a Postgres enum) so it can extend at
 * any time; valid values are validated in TypeScript at the storage layer.
 *
 * Valid types as of Sprint 2a:
 *   email_sent | email_opened | email_clicked | email_replied | email_bounced
 *   form_submitted | page_viewed | note_added | stage_changed | imported
 *   unsubscribed
 */
export const contactActivities = pgTable(
  "contact_activities",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    // Nullable: allows system activities without brand scope.
    brandId: varchar("brand_id", { length: 36 }).references(() => brands.id),
    // Sprint 2o.0 Step 4.1 — additive: nullable. Left nullable in 5b1a
    // because contactActivities has a surrogate uuid PK, so no PK swap
    // is needed here (only contactTagAssignments needed that). Step 5b2
    // (2026-04-23) dropped the legacy contact_id sibling; this column is
    // now the sole entity-FK on the table.
    prospectId: varchar("prospect_id", { length: 36 })
      .references(() => marketingProspects.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    // Sprint 2f: who initiated the activity (manual logger or actor of a
    // system event). Nullable: background/system emissions have no actor.
    // No cascade — preserve activity history if the user is later deleted.
    actorId: varchar("actor_id", { length: 36 }).references(() => users.id),
    // Sprint 2f: when the activity actually happened (vs. when the row was
    // inserted). Defaults to now() but manual logs may backdate within
    // route-enforced bounds (>5min future / >5yr past = 400).
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    // Sprint 2f: timeline + firehose order by occurred_at desc. Old created_at
    // indexes were dropped in favor of these (db:push --force regenerates).
    // Sprint 2o.0 Step 5b2 (2026-04-23): the two contact_id-keyed indexes
    // (`contact_activities_contact_occurred_idx` and
    // `idx_contact_activities_contact_occurred`) auto-dropped at the DB layer
    // alongside the contact_id column drop. Their Drizzle definitions are
    // removed here in lockstep — tsc would otherwise fail on `table.contactId`
    // having no field. Future per-prospect timeline indexes belong here keyed
    // on `prospect_id`.
    contactActivitiesOrgBrandOccurredIdx: index("contact_activities_org_brand_occurred_idx").on(table.orgId, table.brandId, table.occurredAt),
  }),
);

/**
 * Sprint 2o.0 Step 5b1e (HR4) — PSO-side activity timeline.
 *
 * The marketing-side `contact_activities` table is decoupled from the
 * PSO `client_contacts` tree (Dropped in Step 5b2 on 2026-04-23).
 * PSO-side flows (Company Activity timeline, `createContact` audit trail,
 * `maybeAutoLinkContactCompany` audit trail) need their own activity store
 * with FKs to PSO entities only.
 *
 * Strict HR4 separation:
 *   - FKs: orgs, client_contacts, companies (PSO), users only.
 *   - NO brandId column — brands stay marketing-only per HR4.
 *   - NO FK to marketing_prospects / marketing_companies / brands.
 *
 * Column shape mirrors `contact_activities` (Sprint 2f convention):
 * `payload jsonb`, `actorId` nullable FK, `occurredAt + createdAt` separate
 * timestamps. The `type` column is plain text validated at the TS layer
 * via `PsoContactActivityType` (no Postgres enum, so new types extend at
 * zero migration cost).
 */
export const psoContactActivities = pgTable(
  "pso_contact_activities",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 })
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    clientContactId: varchar("client_contact_id", { length: 36 })
      .notNull()
      .references(() => clientContacts.id, { onDelete: "cascade" }),
    // Nullable: a contact may not yet be linked to a company at activity time.
    companyId: varchar("company_id", { length: 36 })
      .references(() => companies.id, { onDelete: "set null" }),
    // Nullable: matches contact_activities.actorId — system emissions have
    // no actor. No cascade — preserve activity history if the user is
    // later deleted (mirrors contact_activities.actorId behavior).
    actorId: varchar("actor_id", { length: 36 }).references(() => users.id),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    psoContactActivitiesOrgContactIdx: index("pso_contact_activities_org_contact_idx")
      .on(table.orgId, table.clientContactId),
    // listCompanyActivities orders by createdAt DESC — index matches the
    // query shape so the per-company timeline is an index seek with no
    // Sort node.
    psoContactActivitiesOrgCompanyCreatedIdx: index("pso_contact_activities_org_company_created_idx")
      .on(table.orgId, table.companyId, sql`created_at DESC`),
  }),
);

/**
 * Sprint 2o.0 Step 5b1e — TS-layer string-literal union of valid `type`
 * values for `pso_contact_activities`. Mirrors the contact_activities
 * convention: extensibility lives in TS, not in a Postgres enum.
 */
export type PsoContactActivityType = "contact_created" | "company_linked";

export type PsoContactActivity = typeof psoContactActivities.$inferSelect;
export type InsertPsoContactActivity = typeof psoContactActivities.$inferInsert;

/**
 * CSV import job log. The schema lands now (Sprint 2a) so the engine can
 * ship in Sprint 2b without a follow-up migration. `errors_json` is jsonb
 * so we can store per-row error detail without a separate errors table.
 *
 * Valid status values: pending | processing | completed | failed
 */
export const contactImports = pgTable(
  "contact_imports",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    brandId: varchar("brand_id", { length: 36 }).notNull().references(() => brands.id),
    userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
    fileName: text("file_name").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    successCount: integer("success_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
    taggedCount: integer("tagged_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    progressCount: integer("progress_count").notNull().default(0),
    status: text("status").notNull().default("pending"),
    errorsJson: jsonb("errors_json").default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    contactImportsOrgBrandCreatedIdx: index("contact_imports_org_brand_created_idx").on(table.orgId, table.brandId, table.createdAt),
  }),
);

// ── Insert schemas + types ────────────────────────────────────────────────
export const insertContactTagSchema = createInsertSchema(contactTags).omit({
  id: true,
  createdAt: true,
});
export type ContactTag = typeof contactTags.$inferSelect;
export type InsertContactTag = z.infer<typeof insertContactTagSchema>;

export const insertContactTagAssignmentSchema = createInsertSchema(contactTagAssignments).omit({
  createdAt: true,
});
export type ContactTagAssignment = typeof contactTagAssignments.$inferSelect;
export type InsertContactTagAssignment = z.infer<typeof insertContactTagAssignmentSchema>;

/**
 * Sprint 2f — Manual write set (the ONLY public-write surface).
 *
 * Validates the body of POST /api/marketing/contacts/:id/activities. The
 * route also enforces cross-brand contact ownership and `occurredAt`
 * future/past bounds (>5 min future or >5 yr past = 400). Exactly four
 * variants — `custom` was DROPPED (R7); freeform entries use `note`.
 *
 * System-side variants (`contact_created`, `tag_added`, etc.) are NOT
 * in this union — they live in `insertContactActivitySystemSchema` and
 * are callable only from inside emission helpers. The route rejects
 * any system type with 400 to prevent spoofing of audit rows.
 */
export const insertContactActivityManualSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("note"),
    payload: z.object({
      body: z.string().min(1).max(10_000),
    }).strict(),
  }),
  z.object({
    type: z.literal("call"),
    payload: z.object({
      duration_minutes: z.number().int().nonnegative().max(24 * 60),
      outcome: z.string().max(200).optional(),
      notes: z.string().max(10_000).optional(),
    }).strict(),
  }),
  z.object({
    type: z.literal("meeting"),
    payload: z.object({
      duration_minutes: z.number().int().nonnegative().max(24 * 60),
      subject: z.string().min(1).max(200),
      notes: z.string().max(10_000).optional(),
    }).strict(),
  }),
  z.object({
    type: z.literal("email_manual"),
    payload: z.object({
      subject: z.string().min(1).max(200),
      body_preview: z.string().max(10_000).optional(),
    }).strict(),
  }),
]);
export type InsertContactActivityManual = z.infer<typeof insertContactActivityManualSchema>;

/**
 * Sprint 2f — System write set (server-internal only, NEVER reachable from
 * the public POST route).
 *
 * Emitted single-tx with the parent write inside contact create / tag
 * assign+unassign / segment add+remove (where membership routes exist) /
 * CSV import completion. `actor_id` is filled from `req.session.userId!`
 * for user-initiated actions and is null for background emissions.
 *
 * Reserved for later sprints (NOT in either union this sprint):
 *   - `contact_updated` — R3, scope to stage/owner changes only when
 *     reintroduced; contact PATCH currently emits nothing.
 *   - Sprint 3 email engine: `email_auto, email_opened, email_clicked,
 *     email_replied, email_bounced, email_unsubscribed, sequence_enrolled,
 *     sequence_exited`.
 */
export const insertContactActivitySystemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("contact_created"),
    payload: z.object({}).strict(),
  }),
  z.object({
    type: z.literal("tag_added"),
    payload: z.object({
      tag_id: z.string().uuid(),
      tag_name: z.string().max(200),
    }).strict(),
  }),
  z.object({
    type: z.literal("tag_removed"),
    payload: z.object({
      tag_id: z.string().uuid(),
      tag_name: z.string().max(200),
    }).strict(),
  }),
  z.object({
    type: z.literal("segment_added"),
    payload: z.object({
      segment_id: z.string().uuid(),
      segment_name: z.string().max(200),
    }).strict(),
  }),
  z.object({
    type: z.literal("segment_removed"),
    payload: z.object({
      segment_id: z.string().uuid(),
      segment_name: z.string().max(200),
    }).strict(),
  }),
  z.object({
    type: z.literal("imported"),
    payload: z.object({
      count: z.number().int().nonnegative(),
      file_name: z.string().max(500),
    }).strict(),
  }),
]);
export type InsertContactActivitySystem = z.infer<typeof insertContactActivitySystemSchema>;

/** Sprint 2f manual write types (literal strings, used by route guards). */
export const CONTACT_ACTIVITY_MANUAL_TYPES = [
  "note", "call", "meeting", "email_manual",
] as const;
export type ContactActivityManualType = typeof CONTACT_ACTIVITY_MANUAL_TYPES[number];

/** Sprint 2f system write types (literal strings, used by route guards). */
export const CONTACT_ACTIVITY_SYSTEM_TYPES = [
  "contact_created", "tag_added", "tag_removed",
  "segment_added", "segment_removed", "imported",
] as const;
export type ContactActivitySystemType = typeof CONTACT_ACTIVITY_SYSTEM_TYPES[number];

// Storage-layer typing only — union of manual + system. Routes never use
// this directly; they parse against the manual or system schema explicitly.
export const insertContactActivitySchema = createInsertSchema(contactActivities).omit({
  id: true,
  createdAt: true,
});
export type ContactActivity = typeof contactActivities.$inferSelect;
export type InsertContactActivity = z.infer<typeof insertContactActivitySchema>;

export const insertContactImportSchema = createInsertSchema(contactImports).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});
export type ContactImport = typeof contactImports.$inferSelect;
export type InsertContactImport = z.infer<typeof insertContactImportSchema>;

/**
 * Saved CSV → contact field-mapping presets. Per (orgId, brandId, userId)
 * so power users importing from the same source (HubSpot, Apollo, etc.)
 * can re-apply their mapping in one click. `mappingJson` stores the
 * { csvHeader: targetColumn } map produced at the wizard's Map step.
 */
export const contactImportPresets = pgTable(
  "contact_import_presets",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    brandId: varchar("brand_id", { length: 36 }).notNull().references(() => brands.id),
    userId: varchar("user_id", { length: 36 }).notNull().references(() => users.id),
    name: text("name").notNull(),
    mappingJson: jsonb("mapping_json").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    contactImportPresetsScopeIdx: index("contact_import_presets_scope_idx")
      .on(table.orgId, table.brandId, table.userId),
    contactImportPresetsScopeNameUnique: uniqueIndex("contact_import_presets_scope_name_unique")
      .on(table.orgId, table.brandId, table.userId, table.name),
  }),
);

export const insertContactImportPresetSchema = createInsertSchema(contactImportPresets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type ContactImportPreset = typeof contactImportPresets.$inferSelect;
export type InsertContactImportPreset = z.infer<typeof insertContactImportPresetSchema>;

// ── Marketing OS Sprint 2b: companies ────────────────────────────────────
export const companies = pgTable(
  "companies",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    brandId: varchar("brand_id", { length: 36 }).references((): AnyPgColumn => brands.id),
    name: text("name").notNull(),
    domain: text("domain"),
    industry: text("industry"),
    sizeBand: text("size_band"),
    ownerUserId: varchar("owner_user_id", { length: 36 }).references(() => users.id),
    notes: text("notes"),
    source: text("source").notNull().default("manual"),
    enrichedAt: timestamp("enriched_at"),
    apolloId: text("apollo_id"),
    linkedinUrl: text("linkedin_url"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    companiesOrgBrandIdx: index("companies_org_brand_idx").on(table.orgId, table.brandId),
    companiesOrgBrandNameIdx: index("companies_org_brand_name_idx").on(table.orgId, table.brandId, table.name),
    companiesOrgBrandDomainUniq: uniqueIndex("companies_org_brand_domain_uniq")
      .on(table.orgId, table.brandId, table.domain)
      .where(sql`${table.domain} IS NOT NULL AND ${table.deletedAt} IS NULL`),
    companiesOwnerIdx: index("companies_owner_idx").on(table.orgId, table.ownerUserId),
  }),
);

export const insertCompanySchema = createInsertSchema(companies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;

// ── Marketing OS Sprint 2e: saved segments ──────────────────────────────
/**
 * A reusable, named contact filter snapshot scoped to (orgId, brandId).
 * Sprint 2e contract: `filter` is a strict shape `{ tagIds, search }`
 * validated at the API boundary; the column itself is plain `jsonb` so
 * future filter dimensions (lifecycleStage, leadStatus, …) can extend
 * the API schema without a migration. Members are computed on read by
 * resolving the filter against `client_contacts` — there is no member
 * join table by design.
 */
export const contactSegments = pgTable(
  "contact_segments",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    brandId: varchar("brand_id", { length: 36 }).notNull().references(() => brands.id),
    name: text("name").notNull(),
    filter: jsonb("filter").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    contactSegmentsOrgBrandNameUniq: uniqueIndex("contact_segments_org_brand_name_uniq")
      .on(table.orgId, table.brandId, table.name),
    contactSegmentsOrgBrandIdx: index("contact_segments_org_brand_idx")
      .on(table.orgId, table.brandId),
  }),
);

/**
 * Strict shape for a saved segment's `filter` jsonb column. Mirrors the
 * subset of /api/marketing/contacts query params that compose to a stable
 * audience: tag intersection (AND) and free-text search. Declared BEFORE
 * insertContactSegmentSchema so the insert schema can compose it directly
 * (single source of truth for the strict filter contract).
 */
export const contactSegmentFilterSchema = z.object({
  tagIds: z.array(z.string().uuid()).max(20).default([]),
  search: z.string().max(200).default(""),
}).strict();
export type ContactSegmentFilter = z.infer<typeof contactSegmentFilterSchema>;

export const insertContactSegmentSchema = createInsertSchema(contactSegments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: z.string().trim().min(1).max(80),
  filter: contactSegmentFilterSchema,
});
export type ContactSegment = typeof contactSegments.$inferSelect;
export type InsertContactSegment = z.infer<typeof insertContactSegmentSchema>;

/**
 * The canonical READ-time superset of activity types (legacy + Sprint 2f).
 * Reads (timeline + firehose) surface every value here so historical rows
 * render correctly. WRITES are restricted to the discriminated unions
 * `insertContactActivityManualSchema` (4 manual types) and
 * `insertContactActivitySystemSchema` (6 system types).
 *
 * Sprint 3 email engine + the deferred `contact_updated` type are NOT
 * included until they ship (see system-schema doc comment for the
 * reservation list).
 */
export const CONTACT_ACTIVITY_TYPES = [
  // Legacy types (read-only — kept so historical rows render).
  "email_sent",
  "email_opened",
  "email_clicked",
  "email_replied",
  "email_bounced",
  "form_submitted",
  "page_viewed",
  "note_added",
  "stage_changed",
  "unsubscribed",
  "company_linked",
  // Sprint 2f manual write set.
  "note",
  "call",
  "meeting",
  "email_manual",
  // Sprint 2f system write set.
  "contact_created",
  "tag_added",
  "tag_removed",
  "segment_added",
  "segment_removed",
  "imported",
] as const;
export type ContactActivityType = typeof CONTACT_ACTIVITY_TYPES[number];

// ============================================================================
// Sprint 2i — Per-org Feature Entitlements
// Foundation for flipping Marketing OS (and future add-ons) on/off per tenant
// without a redeploy. No code reads from this table yet (Sprint 2i.2 wires it
// up); the schema exists so the DB foundation lands first.
// ============================================================================
export const orgEntitlementFeatureEnum = pgEnum("org_entitlement_feature", [
  "pso_core",
  "marketing_os",
  "multi_brand",
  "hubspot_bridge",
]);

export const orgEntitlements = pgTable(
  "org_entitlements",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 })
      .notNull()
      .references(() => orgs.id),
    feature: orgEntitlementFeatureEnum("feature").notNull(),
    active: boolean("active").notNull().default(false),
    activatedAt: timestamp("activated_at"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    gracePeriodEndsAt: timestamp("grace_period_ends_at"),
    // Task #392 — Tier-derive marketing_os. When non-null, the row is a
    // legacy add-on grandfather hold: the entitlement stays effective until
    // this timestamp, after which the daily cleanup job (or a lazy-expire
    // on read) flips active=false. Tier-derived rows leave this NULL.
    grandfatherExpiresAt: timestamp("grandfather_expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    orgEntitlementsOrgFeatureUnique: uniqueIndex("org_entitlements_org_feature_unique").on(
      table.orgId,
      table.feature,
    ),
    orgEntitlementsLookupIdx: index("org_entitlements_org_feature_active_idx").on(
      table.orgId,
      table.feature,
      table.active,
    ),
  }),
);

export const insertOrgEntitlementSchema = createInsertSchema(orgEntitlements).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrgEntitlement = z.infer<typeof insertOrgEntitlementSchema>;
export type OrgEntitlement = typeof orgEntitlements.$inferSelect;
// ============================================================================
// Marketing OS — Sprint 2n: Campaign builder + sequence editor
// Lightweight planner-side drafts. No send engine wired yet — these are
// editable surfaces planners use to compose a single email (campaigns) or
// chain of emails with delays (sequences). Brand-scoped via brandId.
// ============================================================================
export const marketingCampaigns = pgTable(
  "marketing_campaigns",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    brandId: varchar("brand_id", { length: 36 }).notNull().references(() => brands.id),
    name: text("name").notNull(),
    subject: text("subject").notNull().default(""),
    fromName: text("from_name").notNull().default(""),
    fromEmail: text("from_email").notNull().default(""),
    replyTo: text("reply_to").notNull().default(""),
    body: text("body").notNull().default(""),
    sendAt: timestamp("send_at"),
    // Task #207 — non-null once the scheduled-send worker has dispatched
    // the broadcast. Used to filter out already-sent campaigns so the
    // worker doesn't re-broadcast on every tick.
    sentAt: timestamp("sent_at"),
    // Task #234 — Audience targeting. `audience_type='all'` (default,
    // backward-compatible) broadcasts to every undeleted brand contact.
    // `audience_type='segment'` resolves recipients from the saved segment
    // referenced by `audience_segment_id` at send time.
    audienceType: text("audience_type").notNull().default("all"),
    audienceSegmentId: varchar("audience_segment_id", { length: 36 })
      .references(() => contactSegments.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    marketingCampaignsOrgBrandIdx: index("marketing_campaigns_org_brand_idx")
      .on(table.orgId, table.brandId),
    marketingCampaignsPendingIdx: index("marketing_campaigns_pending_idx")
      .on(table.sendAt)
      .where(sql`sent_at IS NULL AND send_at IS NOT NULL`),
    marketingCampaignsAudienceSegmentIdx: index(
      "marketing_campaigns_audience_segment_idx",
    )
      .on(table.audienceSegmentId)
      .where(sql`audience_segment_id IS NOT NULL`),
    audienceTypeChk: check(
      "marketing_campaigns_audience_type_chk",
      sql`audience_type IN ('all', 'segment')`,
    ),
    audienceSegmentChk: check(
      "marketing_campaigns_audience_segment_chk",
      sql`(audience_type = 'segment' AND audience_segment_id IS NOT NULL)
        OR (audience_type = 'all' AND audience_segment_id IS NULL)`,
    ),
  }),
);

export const campaignAudienceTypeSchema = z.enum(["all", "segment"]);
export type CampaignAudienceType = z.infer<typeof campaignAudienceTypeSchema>;

export const insertMarketingCampaignSchema = createInsertSchema(marketingCampaigns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  sentAt: true,
}).extend({
  name: z.string().trim().min(1).max(200),
  subject: z.string().max(300).default(""),
  fromName: z.string().max(200).default(""),
  fromEmail: z.string().max(320).default(""),
  replyTo: z.string().max(320).default(""),
  body: z.string().max(50_000).default(""),
  sendAt: z.coerce.date().nullable().optional(),
  audienceType: campaignAudienceTypeSchema.default("all"),
  audienceSegmentId: z.string().uuid().nullable().optional(),
});

/**
 * Cross-field validation for campaign audience targeting. Apply this with
 * `.superRefine(refineCampaignAudience)` after `.omit()`/`.partial()` so the
 * underlying ZodObject stays composable.
 */
export const refineCampaignAudience = (
  val: { audienceType?: CampaignAudienceType; audienceSegmentId?: string | null },
  ctx: z.RefinementCtx,
): void => {
  if (val.audienceType === "segment" && !val.audienceSegmentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["audienceSegmentId"],
      message: "audienceSegmentId is required when audienceType is 'segment'",
    });
  }
  if (val.audienceType === "all" && val.audienceSegmentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["audienceSegmentId"],
      message: "audienceSegmentId must be null when audienceType is 'all'",
    });
  }
};
export type MarketingCampaign = typeof marketingCampaigns.$inferSelect;
export type InsertMarketingCampaign = z.infer<typeof insertMarketingCampaignSchema>;

export const marketingSequences = pgTable(
  "marketing_sequences",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    brandId: varchar("brand_id", { length: 36 }).notNull().references(() => brands.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    fromName: text("from_name").notNull().default(""),
    fromEmail: text("from_email").notNull().default(""),
    replyTo: text("reply_to").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    marketingSequencesOrgBrandIdx: index("marketing_sequences_org_brand_idx")
      .on(table.orgId, table.brandId),
  }),
);

export const insertMarketingSequenceSchema = createInsertSchema(marketingSequences).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(""),
  fromName: z.string().max(200).default(""),
  fromEmail: z.string().max(320).default(""),
  replyTo: z.string().max(320).default(""),
});
export type MarketingSequence = typeof marketingSequences.$inferSelect;
export type InsertMarketingSequence = z.infer<typeof insertMarketingSequenceSchema>;

export const marketingSequenceSteps = pgTable(
  "marketing_sequence_steps",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    sequenceId: varchar("sequence_id", { length: 36 })
      .notNull()
      .references(() => marketingSequences.id, { onDelete: "cascade" }),
    stepOrder: integer("step_order").notNull().default(0),
    delayDays: integer("delay_days").notNull().default(0),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    marketingSequenceStepsSeqOrderIdx: index("marketing_sequence_steps_seq_order_idx")
      .on(table.sequenceId, table.stepOrder),
  }),
);

export const insertMarketingSequenceStepSchema = createInsertSchema(marketingSequenceSteps).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  delayDays: z.number().int().min(0).max(365).default(0),
  stepOrder: z.number().int().min(0).max(100).default(0),
  subject: z.string().max(300).default(""),
  body: z.string().max(50_000).default(""),
});
export type MarketingSequenceStep = typeof marketingSequenceSteps.$inferSelect;
export type InsertMarketingSequenceStep = z.infer<typeof insertMarketingSequenceStepSchema>;

// ============================================================================
// Sprint 2o.0 — Marketing OS Prospect + Company Foundation
// HARD RULE 4: marketing_prospects / marketing_companies are the home of
// top-of-funnel contacts/companies. NO FK from any marketing_* table to
// client_contacts / clients / companies / invoices / etc. Conversion is
// recorded via soft-ref columns + converted_at timestamps only.
// ============================================================================
export const marketingProspectLifecycleStageEnum = pgEnum(
  "marketing_prospect_lifecycle_stage",
  ["lead", "mql", "sql", "opportunity", "converted", "lost", "nurture"],
);

export const marketingCompanies = pgTable(
  "marketing_companies",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    brandId: varchar("brand_id", { length: 36 }).references((): AnyPgColumn => brands.id),
    name: text("name").notNull(),
    domain: text("domain"),
    website: text("website"),
    industry: text("industry"),
    sizeBucket: text("size_bucket"),
    employeeCount: integer("employee_count"),
    annualRevenue: bigint("annual_revenue", { mode: "number" }),
    location: text("location"),
    linkedinUrl: text("linkedin_url"),
    description: text("description"),
    lifecycleStage: text("lifecycle_stage").notNull().default("prospect"),
    enrichment: jsonb("enrichment"),
    customFields: jsonb("custom_fields"),
    ownerUserId: varchar("owner_user_id", { length: 36 }).references(() => users.id),
    convertedAt: timestamp("converted_at"),
    // Soft ref to clients(id) — no FK constraint per HR4
    convertedToClientId: varchar("converted_to_client_id", { length: 36 }),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    mcOrgIdx: index("marketing_companies_org_idx").on(table.orgId),
    mcOrgBrandIdx: index("marketing_companies_org_brand_idx").on(table.orgId, table.brandId),
    mcOrgDomainIdx: index("marketing_companies_org_domain_idx").on(table.orgId, table.domain),
    mcOrgDomainUniq: uniqueIndex("marketing_companies_org_domain_uniq")
      .on(table.orgId, table.domain)
      .where(sql`domain IS NOT NULL`),
  }),
);

export const marketingProspects = pgTable(
  "marketing_prospects",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    brandId: varchar("brand_id", { length: 36 }).references((): AnyPgColumn => brands.id),
    companyId: varchar("company_id", { length: 36 }).references(() => marketingCompanies.id, { onDelete: "set null" }),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    phone: text("phone"),
    title: text("title"),
    linkedinUrl: text("linkedin_url"),
    website: text("website"),
    location: text("location"),
    lifecycleStage: marketingProspectLifecycleStageEnum("lifecycle_stage").notNull().default("lead"),
    leadSource: text("lead_source"),
    leadScore: integer("lead_score").notNull().default(0),
    unsubscribeToken: text("unsubscribe_token").notNull().unique().default(sql`(gen_random_uuid())::text`),
    unsubscribedAt: timestamp("unsubscribed_at"),
    bouncedAt: timestamp("bounced_at"),
    lastActivityAt: timestamp("last_activity_at"),
    enrichment: jsonb("enrichment"),
    customFields: jsonb("custom_fields"),
    notes: text("notes"),
    ownerUserId: varchar("owner_user_id", { length: 36 }).references(() => users.id),
    convertedAt: timestamp("converted_at"),
    // Soft ref to client_contacts(id) — no FK constraint per HR4
    convertedToClientContactId: varchar("converted_to_client_contact_id", { length: 36 }),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    mpOrgIdx: index("marketing_prospects_org_idx").on(table.orgId),
    mpOrgBrandIdx: index("marketing_prospects_org_brand_idx").on(table.orgId, table.brandId),
    mpOrgLifecycleIdx: index("marketing_prospects_org_lifecycle_idx").on(table.orgId, table.lifecycleStage),
    mpOrgEmailIdx: index("marketing_prospects_org_email_idx").on(table.orgId, table.email),
    mpOrgEmailUniq: uniqueIndex("marketing_prospects_org_email_uniq")
      .on(table.orgId, table.email)
      .where(sql`email IS NOT NULL`),
  }),
);

export const insertMarketingCompanySchema = createInsertSchema(marketingCompanies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  convertedAt: true,
  convertedToClientId: true,
  deletedAt: true,
});
export type MarketingCompany = typeof marketingCompanies.$inferSelect;
export type InsertMarketingCompany = z.infer<typeof insertMarketingCompanySchema>;

export const insertMarketingProspectSchema = createInsertSchema(marketingProspects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  convertedAt: true,
  convertedToClientContactId: true,
  deletedAt: true,
  unsubscribeToken: true,
});
export type MarketingProspect = typeof marketingProspects.$inferSelect;
export type InsertMarketingProspect = z.infer<typeof insertMarketingProspectSchema>;
export type MarketingProspectLifecycleStage =
  (typeof marketingProspectLifecycleStageEnum.enumValues)[number];

// ============================================================================
// Sprint M-Chat-1 — Native AI Marketing Chatbot MVP
// Two new tables (`marketing_chat_conversations`, `marketing_chat_messages`)
// + two pgEnums backing the universal /embed/chat.js script. Every column
// is additive; the existing `marketing_prospects` row is referenced via a
// nullable `prospect_id` FK so soft email→lead capture (lead_source='chatbot')
// can link a conversation to its lead row without ever touching PSO tables
// (HR4). All chat code lives under server/marketing/, server/lib/, and
// server/routes/marketing/chat.ts.
// ============================================================================
export const marketingChatConversationStatusEnum = pgEnum(
  "marketing_chat_conversation_status",
  ["active", "ended", "abandoned"],
);

export const marketingChatMessageRoleEnum = pgEnum(
  "marketing_chat_message_role",
  ["user", "assistant", "system"],
);

export const marketingChatConversations = pgTable(
  "marketing_chat_conversations",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    brandId: varchar("brand_id", { length: 36 }).notNull().references((): AnyPgColumn => brands.id),
    // Soft FK to marketing_prospects(id) — set when the visitor types an
    // email mid-chat and softCreateProspectFromChat() upserts the prospect
    // row. ON DELETE SET NULL so prospect cleanup never destroys transcript.
    prospectId: varchar("prospect_id", { length: 36 }).references(
      (): AnyPgColumn => marketingProspects.id,
      { onDelete: "set null" },
    ),
    // Client-supplied UUID stored in localStorage by the embed script.
    // (brandId, sessionToken) is unique → reload picks up the same convo.
    sessionToken: text("session_token").notNull(),
    status: marketingChatConversationStatusEnum("status").notNull().default("active"),
    summary: text("summary"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
    // Per-conversation token budget enforced at the route layer (10K combined).
    tokensInTotal: integer("tokens_in_total").notNull().default(0),
    tokensOutTotal: integer("tokens_out_total").notNull().default(0),
  },
  (table) => ({
    mccOrgBrandIdx: index("marketing_chat_conv_org_brand_idx").on(table.orgId, table.brandId),
    mccBrandSessionUniq: uniqueIndex("marketing_chat_conv_brand_session_uniq").on(
      table.brandId,
      table.sessionToken,
    ),
    mccProspectIdx: index("marketing_chat_conv_prospect_idx")
      .on(table.prospectId)
      .where(sql`prospect_id IS NOT NULL`),
  }),
);

export const marketingChatMessages = pgTable(
  "marketing_chat_messages",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    conversationId: varchar("conversation_id", { length: 36 })
      .notNull()
      .references((): AnyPgColumn => marketingChatConversations.id, { onDelete: "cascade" }),
    role: marketingChatMessageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    model: text("model"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    mcmConvCreatedIdx: index("marketing_chat_msg_conv_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  }),
);

export const insertMarketingChatConversationSchema = createInsertSchema(
  marketingChatConversations,
).omit({
  id: true,
  startedAt: true,
  lastMessageAt: true,
  endedAt: true,
  tokensInTotal: true,
  tokensOutTotal: true,
});
export type MarketingChatConversation = typeof marketingChatConversations.$inferSelect;
export type InsertMarketingChatConversation = z.infer<typeof insertMarketingChatConversationSchema>;

export const insertMarketingChatMessageSchema = createInsertSchema(marketingChatMessages).omit({
  id: true,
  createdAt: true,
});
export type MarketingChatMessage = typeof marketingChatMessages.$inferSelect;
export type InsertMarketingChatMessage = z.infer<typeof insertMarketingChatMessageSchema>;
export type MarketingChatConversationStatus =
  (typeof marketingChatConversationStatusEnum.enumValues)[number];
export type MarketingChatMessageRole =
  (typeof marketingChatMessageRoleEnum.enumValues)[number];

// ── Task #208: Sequence enrollments ───────────────────────────────────
// Tracks which prospects are enrolled in which sequence, where they are
// in the step plan, when the next send is due, and their lifecycle
// status. The scheduled-send worker will read `active` rows whose
// `nextSendAt <= now()` and advance `currentStepIndex`. Pause/remove
// are user-initiated lifecycle transitions surfaced on the sequence
// detail page.
//
// Sprint 2o.0: contact_id (→ client_contacts) replaced with
// prospect_id (→ marketing_prospects) per HR4. Existing table had 0 rows
// at migration time (verified live), so the column was dropped and
// re-added cleanly.
export const marketingSequenceEnrollmentStatusEnum = pgEnum(
  "marketing_sequence_enrollment_status",
  ["active", "paused", "completed", "removed"],
);

export const marketingSequenceEnrollments = pgTable(
  "marketing_sequence_enrollments",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    // FKs explicit-named below to avoid PG's 63-char truncation loop.
    sequenceId: varchar("sequence_id", { length: 36 }).notNull(),
    prospectId: varchar("prospect_id", { length: 36 }).notNull(),
    currentStepIndex: integer("current_step_index").notNull().default(0),
    nextSendAt: timestamp("next_send_at"),
    status: marketingSequenceEnrollmentStatusEnum("status").notNull().default("active"),
    enrolledAt: timestamp("enrolled_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    sequenceFk: foreignKey({
      columns: [table.sequenceId],
      foreignColumns: [marketingSequences.id],
      name: "marketing_sequence_enrollments_sequence_id_marketing_sequences_",
    }).onDelete("cascade"),
    prospectFk: foreignKey({
      columns: [table.prospectId],
      foreignColumns: [marketingProspects.id],
      name: "marketing_sequence_enrollments_prospect_id_marketing_prospects_",
    }).onDelete("cascade"),
    marketingSequenceEnrollmentsSeqProspectUniq: uniqueIndex(
      "marketing_sequence_enrollments_seq_prospect_uniq",
    ).on(table.sequenceId, table.prospectId),
    marketingSequenceEnrollmentsOrgSeqIdx: index(
      "marketing_sequence_enrollments_org_seq_idx",
    ).on(table.orgId, table.sequenceId),
    marketingSequenceEnrollmentsDueIdx: index(
      "marketing_sequence_enrollments_due_idx",
    ).on(table.status, table.nextSendAt),
  }),
);

export const insertMarketingSequenceEnrollmentSchema = createInsertSchema(
  marketingSequenceEnrollments,
).omit({
  id: true,
  enrolledAt: true,
  updatedAt: true,
});
export type MarketingSequenceEnrollment = typeof marketingSequenceEnrollments.$inferSelect;
export type InsertMarketingSequenceEnrollment = z.infer<
  typeof insertMarketingSequenceEnrollmentSchema
>;
export type MarketingSequenceEnrollmentStatus =
  (typeof marketingSequenceEnrollmentStatusEnum.enumValues)[number];

export const ORG_ENTITLEMENT_FEATURES = [
  "pso_core",
  "marketing_os",
  "multi_brand",
  "hubspot_bridge",
] as const;
export type OrgEntitlementFeature = typeof ORG_ENTITLEMENT_FEATURES[number];

// ============================================================================
// Task 181 — Marketing OS discovery telemetry persistence
// Persists the three Sprint 2k discovery surface events emitted by the
// `/api/telemetry/marketing-os` route so that admins can see an in-app funnel
// (shown -> modal_opened -> checkout_clicked) without grepping log files.
// ============================================================================
export const marketingOsTelemetryEventTypeEnum = pgEnum(
  "marketing_os_telemetry_event_type",
  ["section_shown", "modal_opened", "checkout_clicked"],
);

// Task 203 — Retention window for `marketing_os_telemetry_events`. The admin
// dashboard (`/api/telemetry/marketing-os/summary`) only ever reads the last
// 30 days, so anything older is dead weight. A periodic sweep deletes rows
// older than this window to keep the table bounded. Override at runtime via
// the `MARKETING_OS_TELEMETRY_RETENTION_DAYS` env var; the default of 180
// days leaves comfortable headroom over the 30-day read window for ad-hoc
// historical comparisons without letting the table grow unboundedly.
export const MARKETING_OS_TELEMETRY_RETENTION_DAYS_DEFAULT = 180;

export const marketingOsTelemetryEvents = pgTable(
  "marketing_os_telemetry_events",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 })
      .notNull()
      .references(() => orgs.id),
    userId: varchar("user_id", { length: 36 }).references(() => users.id),
    eventType: marketingOsTelemetryEventTypeEnum("event_type").notNull(),
    source: text("source"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    marketingOsTelemetryOrgCreatedIdx: index(
      "marketing_os_telemetry_org_created_idx",
    ).on(table.orgId, table.createdAt),
    marketingOsTelemetryOrgEventCreatedIdx: index(
      "marketing_os_telemetry_org_event_created_idx",
    ).on(table.orgId, table.eventType, table.createdAt),
  }),
);

export const insertMarketingOsTelemetryEventSchema = createInsertSchema(
  marketingOsTelemetryEvents,
).omit({
  id: true,
  createdAt: true,
});
export type InsertMarketingOsTelemetryEvent = z.infer<
  typeof insertMarketingOsTelemetryEventSchema
>;
export type MarketingOsTelemetryEvent =
  typeof marketingOsTelemetryEvents.$inferSelect;
export type MarketingOsTelemetryEventType =
  (typeof marketingOsTelemetryEventTypeEnum.enumValues)[number];

export interface MarketingOsTelemetrySummaryWindow {
  days: number;
  sectionShown: number;
  modalOpened: number;
  checkoutClicked: number;
  shownToModalRate: number;
  modalToCheckoutRate: number;
  shownToCheckoutRate: number;
}

export interface MarketingOsTelemetrySummary {
  last7Days: MarketingOsTelemetrySummaryWindow;
  last30Days: MarketingOsTelemetrySummaryWindow;
}

export interface MarketingOsTelemetryDailyBucket {
  date: string;
  sectionShown: number;
  modalOpened: number;
  checkoutClicked: number;
}

export interface MarketingOsTelemetryDailySeries {
  days: number;
  buckets: MarketingOsTelemetryDailyBucket[];
}

// ============================================================================
// Task #243 — Persist a record of each successful telemetry retention sweep
// so admins can confirm from the UI that the cleanup is actually running
// without grepping server logs.
// ============================================================================
export const MARKETING_OS_TELEMETRY_CLEANUP_RUN_HISTORY_LIMIT = 50;

export const marketingOsTelemetryCleanupRuns = pgTable(
  "marketing_os_telemetry_cleanup_runs",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    ranAt: timestamp("ran_at").notNull().defaultNow(),
    deletedCount: integer("deleted_count").notNull(),
    retentionDays: integer("retention_days").notNull(),
    cutoff: timestamp("cutoff").notNull(),
  },
  (table) => ({
    marketingOsTelemetryCleanupRunsRanAtIdx: index(
      "marketing_os_telemetry_cleanup_runs_ran_at_idx",
    ).on(table.ranAt),
  }),
);

export type MarketingOsTelemetryCleanupRunRow =
  typeof marketingOsTelemetryCleanupRuns.$inferSelect;

export interface MarketingOsTelemetryLastCleanup {
  ranAt: string;
  deletedCount: number;
  retentionDays: number;
  cutoff: string;
}

// ============================================================================
// Task #318 — Track when admins were last emailed about a silent telemetry
// cleanup sweep so we don't re-alert every tick while the scheduler stays
// quiet. A successful cleanup run (recorded in
// `marketing_os_telemetry_cleanup_runs`) implicitly resets the dedupe
// because the decision logic compares the most recent recorded run against
// the most recent stamped alert.
// ============================================================================
export const marketingOsTelemetryCleanupSilenceAlerts = pgTable(
  "marketing_os_telemetry_cleanup_silence_alerts",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
    healthStatus: text("health_status").notNull(),
    // BIGINT: ageMs is milliseconds since the last cleanup run. A
    // 32-bit INTEGER would overflow after ~24.8 days of silence, which
    // is exactly the regime this alert is meant to surface.
    ageMs: bigint("age_ms", { mode: "number" }),
    notifiedCount: integer("notified_count").notNull(),
  },
  (table) => ({
    marketingOsTelemetryCleanupSilenceAlertsSentAtIdx: index(
      "marketing_os_telemetry_cleanup_silence_alerts_sent_at_idx",
    ).on(table.sentAt),
  }),
);

export type MarketingOsTelemetryCleanupSilenceAlertRow =
  typeof marketingOsTelemetryCleanupSilenceAlerts.$inferSelect;

/**
 * Task #188 — Persistent threshold-breach alert log for outgoing email
 * failures. Backs `getRecentFailureAlerts` so the admin dashboard's
 * history survives process restarts. The per-org slice is stored in
 * `byOrg` jsonb so the per-tenant projection
 * (`getRecentFailureAlerts(orgScope)`) keeps working without a second
 * table.
 */
export interface EmailFailureAlertOrgSlice {
  failureCount: number;
  topTransport: string | null;
  topErrorCode: string | null;
}

export const emailFailureAlerts = pgTable(
  "email_failure_alerts",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    ts: timestamp("ts").notNull().defaultNow(),
    failureCount: integer("failure_count").notNull(),
    threshold: integer("threshold").notNull(),
    thresholdBreached: boolean("threshold_breached").notNull().default(true),
    topTransport: text("top_transport"),
    topErrorCode: text("top_error_code"),
    delivered: boolean("delivered").notNull().default(false),
    byOrg: jsonb("by_org")
      .$type<Record<string, EmailFailureAlertOrgSlice>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Task #313 — discriminator so a silenced-send-spike webhook alert
    // shows up alongside transport-failure alerts in the same history
    // view without losing the distinction. Legacy rows default to
    // 'transport_failure'.
    alertKind: text("alert_kind").notNull().default("transport_failure"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    emailFailureAlertsTsIdx: index("email_failure_alerts_ts_idx").on(table.ts),
    emailFailureAlertsKindTsIdx: index("email_failure_alerts_kind_ts_idx").on(
      table.alertKind,
      table.ts,
    ),
  }),
);

/**
 * Task #313 — possible values for `email_failure_alerts.alert_kind`.
 * Exported as a const-tuple union so the failure-tracker and routes
 * can share one source of truth.
 */
export const EMAIL_FAILURE_ALERT_KINDS = [
  "transport_failure",
  "suppressed_spike",
] as const;
export type EmailFailureAlertKind = (typeof EMAIL_FAILURE_ALERT_KINDS)[number];

export type EmailFailureAlertRow = typeof emailFailureAlerts.$inferSelect;

/**
 * Task #280 — Operator-curated list of orgs that should always appear
 * in the per-org breakdown attached to the cross-tenant alert webhook
 * payload, when they contributed at least one failure to the breach
 * window. Lets operators pin high-priority customers so they aren't
 * crowded out of the top-5 by noisy lower-tier orgs.
 */
export const emailAlertPinnedOrgs = pgTable("email_alert_pinned_orgs", {
  orgId: varchar("org_id", { length: 36 }).primaryKey(),
  pinnedAt: timestamp("pinned_at").notNull().defaultNow(),
  pinnedBy: text("pinned_by"),
  note: text("note"),
});

export type EmailAlertPinnedOrgRow = typeof emailAlertPinnedOrgs.$inferSelect;

// ============================================================================
// Task #235 — Per-recipient send attempts for marketing campaigns + sequence
// enrollments. The scheduled-send worker writes one row per attempt so the
// retry loop can compute the next backoff and so admins can see exactly which
// recipients did not receive the email. Status semantics:
//   - "success"            — message accepted by the transport.
//   - "failed"             — transient failure; will be retried after
//                             `nextRetryAt`.
//   - "permanent_failure"  — gave up (max attempts hit, or the error was
//                             classified as non-transient). `nextRetryAt`
//                             is null on these rows.
// ============================================================================
export const emailSendAttemptKindEnum = pgEnum(
  "email_send_attempt_kind",
  ["campaign", "sequence"],
);
export const emailSendAttemptStatusEnum = pgEnum(
  "email_send_attempt_status",
  ["success", "failed", "permanent_failure"],
);

export const emailSendAttempts = pgTable(
  "email_send_attempts",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    orgId: varchar("org_id", { length: 36 }).notNull().references(() => orgs.id),
    kind: emailSendAttemptKindEnum("kind").notNull(),
    campaignId: varchar("campaign_id", { length: 36 }).references(
      () => marketingCampaigns.id,
      { onDelete: "cascade" },
    ),
    sequenceId: varchar("sequence_id", { length: 36 }).references(
      () => marketingSequences.id,
      { onDelete: "cascade" },
    ),
    // FK explicit-named below to avoid PG's 63-char truncation loop.
    enrollmentId: varchar("enrollment_id", { length: 36 }),
    stepIndex: integer("step_index"),
    // Sprint 2o.0 Step 4.1 — full swap (was contactId → clientContacts).
    // Live DB had 0 non-null contact_id rows so the legacy column is
    // dropped outright by migration 0019; no deprecated marker needed
    // because there's nothing to backfill in Step 5b.
    prospectId: varchar("prospect_id", { length: 36 }).references(
      () => marketingProspects.id,
      { onDelete: "set null" },
    ),
    recipientEmail: text("recipient_email"),
    attemptNumber: integer("attempt_number").notNull().default(1),
    status: emailSendAttemptStatusEnum("status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    transport: text("transport"),
    providerMessageId: text("provider_message_id"),
    attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
    nextRetryAt: timestamp("next_retry_at"),
  },
  (table) => ({
    enrollmentFk: foreignKey({
      columns: [table.enrollmentId],
      foreignColumns: [marketingSequenceEnrollments.id],
      name: "email_send_attempts_enrollment_id_marketing_sequence_enrollment",
    }).onDelete("cascade"),
    // Prod has only the retry index; the legacy campaign/sequence indexes
    // were removed by migration 0012-email-send-attempts.sql.
    emailSendAttemptsRetryIdx: index("email_send_attempts_retry_idx")
      .on(table.status, table.nextRetryAt),
  }),
);

export type EmailSendAttempt = typeof emailSendAttempts.$inferSelect;
export type EmailSendAttemptKind = (typeof emailSendAttemptKindEnum.enumValues)[number];
export type EmailSendAttemptStatus = (typeof emailSendAttemptStatusEnum.enumValues)[number];

/**
 * Task #252 — Persistent masked-recipient suppressions. The admin
 * "Suppressed" tab previously kept these in a process-local Map, which
 * meant a deploy or restart silently re-enabled mail to chronic
 * failing recipients. Persisting them keyed by (orgId, hash) ensures
 * the suppression actually sticks across boots, while the per-entry
 * `suppressedSends` / `lastSuppressedAt` counters preserve the
 * dashboard's "how many sends were prevented" stat across restarts.
 */
export const emailRecipientSuppressions = pgTable(
  "email_recipient_suppressions",
  {
    orgId: varchar("org_id", { length: 36 }).notNull(),
    hash: varchar("hash", { length: 16 }).notNull(),
    maskedRecipient: text("masked_recipient").notNull(),
    reason: text("reason").notNull().default("manual:admin"),
    addedAt: timestamp("added_at").notNull().defaultNow(),
    addedBy: text("added_by"),
    suppressedSends: integer("suppressed_sends").notNull().default(0),
    lastSuppressedAt: timestamp("last_suppressed_at"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.orgId, table.hash] }),
    orgIdx: index("email_recipient_suppressions_org_idx").on(table.orgId),
  }),
);

export type EmailRecipientSuppressionRow =
  typeof emailRecipientSuppressions.$inferSelect;
export const insertEmailRecipientSuppressionSchema = createInsertSchema(
  emailRecipientSuppressions,
).omit({ addedAt: true, suppressedSends: true, lastSuppressedAt: true });
export type InsertEmailRecipientSuppression = z.infer<
  typeof insertEmailRecipientSuppressionSchema
>;

// connect-pg-simple session store; managed by express-session middleware.
export const session = pgTable(
  "session",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (table) => [
    index("IDX_session_expire").on(table.expire),
  ],
);

// MFA enrollment per user (TOTP + recovery codes + future WebAuthn).
export const mfaEnrollments = pgTable(
  "mfa_enrollments",
  {
    userId: varchar("user_id", { length: 36 }).primaryKey(),
    orgId: varchar("org_id", { length: 36 }).notNull(),
    secret: text("secret").notNull(),
    method: text("method").notNull().default("totp"),
    enabled: boolean("enabled").notNull().default(false),
    recoveryCodes: jsonb("recovery_codes").notNull().default(sql`'[]'::jsonb`),
    usedRecoveryCodes: jsonb("used_recovery_codes").notNull().default(sql`'[]'::jsonb`),
    webauthnCredentials: jsonb("webauthn_credentials").notNull().default(sql`'[]'::jsonb`),
    enforceForAdmins: boolean("enforce_for_admins").notNull().default(false),
    enrolledAt: timestamp("enrolled_at").notNull().defaultNow(),
    lastVerifiedAt: timestamp("last_verified_at"),
  },
  (table) => [
    // Explicit `_fkey` suffix matches the prod bootstrap (raw SQL in
    // server/migrate-production.ts). Drizzle's default `_fk` would loop.
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "mfa_enrollments_user_id_fkey",
    }),
    foreignKey({
      columns: [table.orgId],
      foreignColumns: [orgs.id],
      name: "mfa_enrollments_org_id_fkey",
    }),
    index("idx_mfa_enrollments_org").on(table.orgId),
  ],
);

export type MfaEnrollment = typeof mfaEnrollments.$inferSelect;

// Sprint 2o.0 ID-rewrite audit log (one row per migrated entity).
export const sprint2o0MigrationAudit = pgTable(
  "sprint_2o0_migration_audit",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    oldId: varchar("old_id", { length: 36 }).notNull(),
    newId: varchar("new_id", { length: 36 }).notNull(),
    orgId: varchar("org_id", { length: 36 }).notNull(),
    brandId: varchar("brand_id", { length: 36 }),
    identifyingField: text("identifying_field"),
    lifecycleStage: text("lifecycle_stage").notNull(),
    migrationSource: text("migration_source")
      .notNull()
      .default("sprint-2o.0-0020"),
    dedupRole: text("dedup_role"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // UNIQUE constraint (not index) — matches the prod DDL.
    unique("sprint_2o0_audit_unique").on(table.entityType, table.oldId),
  ],
);

export type Sprint2o0MigrationAuditRow = typeof sprint2o0MigrationAudit.$inferSelect;
