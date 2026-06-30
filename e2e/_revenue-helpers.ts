import { Pool } from "pg";
import bcrypt from "bcryptjs";
import { randomUUID, randomBytes } from "node:crypto";
import {
  request as pwRequest,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import Stripe from "stripe";
import { BASE } from "../tests/helpers/po/isolation";

let _pool: Pool | null = null;
export function revPool(): Pool {
  if (_pool) return _pool;
  if (!process.env.DATABASE_URL) {
    throw new Error("[revenue-helpers] DATABASE_URL not set");
  }
  _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return _pool;
}
export async function closeRevPool(): Promise<void> {
  if (_pool) {
    await _pool.end().catch(() => undefined);
    _pool = null;
  }
}

export async function insertClient(
  orgId: string,
  name = `rev client ${Date.now()}`,
): Promise<string> {
  const r = await revPool().query<{ id: string }>(
    `INSERT INTO clients (org_id, name, email) VALUES ($1,$2,$3) RETURNING id`,
    [orgId, name, `rev-${randomUUID().slice(0, 8)}@example.com`],
  );
  return r.rows[0].id;
}

export async function insertSentInvoice(
  orgId: string,
  clientId: string,
  total: string,
  withLines = true,
): Promise<{ invoiceId: string; number: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const number = `INV-REV-${randomUUID().slice(0, 8)}`;
  const inv = await revPool().query<{ id: string }>(
    `INSERT INTO invoices
       (org_id, client_id, number, status, issued_date, due_date,
        currency, exchange_rate, subtotal, discount_type, discount_value,
        discount_amount, tax_rate, tax_amount, total, paid_amount)
     VALUES ($1,$2,$3,'SENT',$4,$4,'USD','1',$5,'NONE','0','0','0','0',$5,'0')
     RETURNING id`,
    [orgId, clientId, number, today, total],
  );
  const id = inv.rows[0].id;
  if (withLines) {
    await revPool().query(
      `INSERT INTO invoice_lines (org_id, invoice_id, description, quantity, unit_rate, amount)
       VALUES ($1,$2,'rev test line',1,$3,$3)`,
      [orgId, id, total],
    );
  }
  return { invoiceId: id, number };
}

export async function insertDraftInvoiceNoLines(
  orgId: string,
  clientId: string,
  total = "0",
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const number = `INV-PG-${randomUUID().slice(0, 8)}`;
  const r = await revPool().query<{ id: string }>(
    `INSERT INTO invoices
       (org_id, client_id, number, status, issued_date, due_date,
        currency, exchange_rate, subtotal, discount_type, discount_value,
        discount_amount, tax_rate, tax_amount, total, paid_amount)
     VALUES ($1,$2,$3,'DRAFT',$4,$4,'USD','1',$5,'NONE','0','0','0','0',$5,'0')
     RETURNING id`,
    [orgId, clientId, number, today, total],
  );
  return r.rows[0].id;
}

export async function createManagerUser(
  orgId: string,
): Promise<{ email: string; password: string; userId: string }> {
  const localId = randomUUID().replace(/-/g, "").slice(0, 12);
  const email = `mgr-${localId}@e2e-${localId}.test`;
  const password = `MgrPass!${localId}`;
  const hashed = await bcrypt.hash(password, 10);
  const r = await revPool().query<{ id: string }>(
    `INSERT INTO users
       (org_id, email, password, name, first_name, last_name, role,
        is_active, onboarding_complete, temp_password)
     VALUES ($1,$2,$3,$4,'Mgr','User','MANAGER',true,true,false)
     RETURNING id`,
    [orgId, email, hashed, `Mgr ${localId}`],
  );
  return { email, password, userId: r.rows[0].id };
}

export async function createTeamMember(
  orgId: string,
  opts: {
    workerType?: "INDEPENDENT" | "W2_EMPLOYEE";
    stripeConnectStatus?: string | null;
    stripeConnectAccountId?: string | null;
  } = {},
): Promise<string> {
  const localId = randomUUID().replace(/-/g, "").slice(0, 12);
  const email = `tm-${localId}@e2e-${localId}.test`;
  const r = await revPool().query<{ id: string }>(
    `INSERT INTO users
       (org_id, email, password, name, first_name, last_name, role,
        is_active, onboarding_complete, temp_password,
        worker_type, stripe_connect_status, stripe_connect_account_id)
     VALUES ($1,$2,$3,$4,'Team','Member','TEAM_MEMBER',true,true,false,
             $5,$6,$7)
     RETURNING id`,
    [
      orgId,
      email,
      await bcrypt.hash("nope", 4),
      `TM ${localId}`,
      opts.workerType ?? "INDEPENDENT",
      opts.stripeConnectStatus ?? "NOT_STARTED",
      opts.stripeConnectAccountId ?? null,
    ],
  );
  return r.rows[0].id;
}

export async function buildAuthedRequest(
  email: string,
  password: string,
): Promise<{ request: APIRequestContext; csrf: string }> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const login = await ctx.post(`${BASE}/api/auth/login`, {
    data: { email, password },
  });
  if (login.status() !== 200) {
    await ctx.dispose();
    throw new Error(
      `[revenue-helpers] login failed (${email}): ${login.status()}`,
    );
  }
  const csrfRes = await ctx.get(`${BASE}/api/csrf-token`);
  if (csrfRes.status() !== 200) {
    await ctx.dispose();
    throw new Error(`[revenue-helpers] csrf failed: ${csrfRes.status()}`);
  }
  const csrf = csrfRes.headers()["x-csrf-token"] || "";
  return { request: ctx, csrf };
}

let _stripeForSig: Stripe | null = null;
function stripeForSig(): Stripe {
  if (_stripeForSig) return _stripeForSig;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "[revenue-helpers] STRIPE_SECRET_KEY required to construct Stripe SDK for signing",
    );
  }
  _stripeForSig = new Stripe(key);
  return _stripeForSig;
}

export interface BuildEventOpts {
  type: string;
  data: Record<string, unknown>;
  id?: string;
}
export interface StripeEvent {
  id: string;
  object: "event";
  api_version: string;
  created: number;
  type: string;
  livemode: boolean;
  pending_webhooks: number;
  request: { id: null; idempotency_key: null };
  data: { object: Record<string, unknown> };
}
export function buildStripeEvent(opts: BuildEventOpts): StripeEvent {
  const id = opts.id ?? `evt_e2e_${randomBytes(8).toString("hex")}`;
  return {
    id,
    object: "event",
    api_version: "2024-04-10",
    created: Math.floor(Date.now() / 1000),
    type: opts.type,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object: opts.data },
  };
}

export function signStripePayload(payload: string): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "[revenue-helpers] STRIPE_WEBHOOK_SECRET required to sign webhook events",
    );
  }
  return stripeForSig().webhooks.generateTestHeaderString({
    payload,
    secret,
    timestamp: Math.floor(Date.now() / 1000),
  });
}

export async function fireSignedStripeEvent(
  request: APIRequestContext,
  event: StripeEvent,
): Promise<APIResponse> {
  const payload = JSON.stringify(event);
  const sig = signStripePayload(payload);
  return request.post(`${BASE}/api/webhooks/stripe`, {
    headers: {
      "content-type": "application/json",
      "stripe-signature": sig,
    },
    data: payload,
  });
}

export async function setOrgStripeCustomer(
  orgId: string,
  customerId: string,
): Promise<void> {
  await revPool().query(
    `UPDATE orgs SET stripe_customer_id = $1 WHERE id = $2`,
    [customerId, orgId],
  );
}

export interface OrgBilling {
  planTier: string | null;
  subscriptionStatus: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
}
export async function readOrgBilling(orgId: string): Promise<OrgBilling> {
  const r = await revPool().query<{
    plan_tier: string | null;
    subscription_status: string | null;
    stripe_subscription_id: string | null;
    stripe_customer_id: string | null;
  }>(
    `SELECT plan_tier, subscription_status, stripe_subscription_id, stripe_customer_id
       FROM orgs WHERE id = $1`,
    [orgId],
  );
  const row = r.rows[0];
  return {
    planTier: row?.plan_tier ?? null,
    subscriptionStatus: row?.subscription_status ?? null,
    stripeSubscriptionId: row?.stripe_subscription_id ?? null,
    stripeCustomerId: row?.stripe_customer_id ?? null,
  };
}

export async function payoutDedupIndexInstalled(): Promise<boolean> {
  const r = await revPool().query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname  = 'uq_payout_dedup'
     ) AS exists`,
  );
  return r.rows[0]?.exists === true;
}

export async function sweepOrgRevenue(orgId: string): Promise<void> {
  const p = revPool();
  for (const sql of [
    `DELETE FROM payouts_time_entries WHERE org_id = $1`,
    `DELETE FROM payout_time_entries WHERE org_id = $1`,
    `DELETE FROM team_member_payouts_v2 WHERE org_id = $1`,
    `DELETE FROM payments WHERE org_id = $1`,
    `DELETE FROM invoice_lines WHERE org_id = $1`,
    `DELETE FROM invoices WHERE org_id = $1`,
    `DELETE FROM estimate_lines WHERE org_id = $1`,
    `DELETE FROM estimates WHERE org_id = $1`,
    `DELETE FROM recurring_invoice_templates WHERE org_id = $1`,
    `DELETE FROM client_activities WHERE org_id = $1`,
    `DELETE FROM stripe_events WHERE org_id = $1`,
    `DELETE FROM org_entitlements WHERE org_id = $1`,
  ]) {
    await p.query(sql, [orgId]).catch(() => undefined);
  }
}
