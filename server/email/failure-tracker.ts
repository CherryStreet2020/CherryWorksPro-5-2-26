import { createHash } from "crypto";
import { structuredLog } from "../lib/logging";
import type { EmailTransport, SendableMessage, SendResult } from "./types";
import { EmailTransportError, MissingMailboxError } from "./types";
import { db, pool } from "../db";
import {
  auditLogs,
  emailAlertPinnedOrgs,
  emailFailureAlerts,
  emailRecipientSuppressions,
  type EmailFailureAlertOrgSlice,
  type EmailFailureAlertKind,
} from "@shared/schema";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";

export interface EmailFailureSample {
  ts: number;
  orgId: string;
  transport: string;
  errorCode: string;
  recipient: string | null;
}

/**
 * Mask a recipient email so admins can recognize repeated targets without
 * exposing the raw address. Returns a string of the form
 * `a***@e***.com (#a3f9)` where the trailing 4-char hex is a stable hash
 * over the lowercased address (so two failures to the same recipient
 * collide in triage), or `null` if no usable address was supplied.
 */
export function maskRecipient(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const hash = createHash("sha256").update(lower).digest("hex").slice(0, 4);
  const at = lower.lastIndexOf("@");
  if (at <= 0 || at === lower.length - 1) {
    const head = lower[0] ?? "?";
    return `${head}*** (#${hash})`;
  }
  const local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const localHead = local[0] ?? "?";
  if (dot <= 0) {
    return `${localHead}***@${domain[0] ?? "?"}*** (#${hash})`;
  }
  const domainHead = domain[0] ?? "?";
  const tld = domain.slice(dot);
  return `${localHead}***@${domainHead}***${tld} (#${hash})`;
}

const ROLLING_WINDOW_MS = 60 * 60 * 1000;
const MAX_SAMPLES = 500;
const samples: EmailFailureSample[] = [];

const totalsByTransport = new Map<string, number>();
const lastErrorByTransport = new Map<
  string,
  { ts: number; orgId: string; errorCode: string }
>();
let totalSinceBoot = 0;

export interface MaskedRecipientSuppression {
  orgId: string;
  hash: string;
  maskedRecipient: string;
  reason: string;
  addedAt: number;
  addedBy: string | null;
  suppressedSends: number;
  lastSuppressedAt: number | null;
}

const maskedRecipientSuppressions = new Map<string, MaskedRecipientSuppression>();
let suppressedSendsSinceBoot = 0;
const suppressedSendsByTransport = new Map<string, number>();
const suppressedSendsByReason = new Map<string, number>();

/**
 * Normalize a stored suppression reason (e.g. "bounce:hard",
 * "complaint:abuse", "manual:admin") down to its top-level bucket
 * ("bounce", "complaint", "manual") for the breakdown shown on the
 * suppressions panel. Reasons follow a `<bucket>:<detail>` convention;
 * if no detail prefix is present the whole reason is used. An empty or
 * missing reason falls back to "other".
 */
export function normalizeSuppressionReason(
  reason: string | null | undefined,
): string {
  if (!reason) return "other";
  const trimmed = String(reason).trim().toLowerCase();
  if (!trimmed) return "other";
  const colon = trimmed.indexOf(":");
  const head = (colon >= 0 ? trimmed.slice(0, colon) : trimmed).trim();
  return head || "other";
}

interface SuppressedSendSample {
  ts: number;
  orgId: string;
  transport: string;
  reason: string;
}
const suppressedSamples: SuppressedSendSample[] = [];
const MAX_SUPPRESSED_SAMPLES = 500;

function pruneSuppressedSamples(now: number): void {
  const cutoff = now - ROLLING_WINDOW_MS;
  while (suppressedSamples.length > 0 && suppressedSamples[0].ts < cutoff) {
    suppressedSamples.shift();
  }
}

/**
 * Default per-hour threshold for silenced (suppression-list) sends.
 * Distinct from the transport-failure threshold — a sudden spike in
 * silenced sends is the canonical signal of an over-broad bulk
 * suppression and warrants its own warning state on the health panel.
 * Override via `EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR`.
 */
export const DEFAULT_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR = 25;

/**
 * Resolve the silenced-send per-hour warning threshold.
 *
 * Resolution order (Task #314):
 *   1. `orgOverride` — per-org value persisted on
 *      `orgs.email_suppressed_alert_threshold_per_hour`. NULL means
 *      "no override; fall through".
 *   2. `EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR` env var.
 *   3. `DEFAULT_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR` (25).
 *
 * Non-finite or non-positive overrides are ignored at every layer so a
 * stale invalid value can never silently disable the warning.
 */
export function getSuppressedAlertThresholdPerHour(
  orgOverride?: number | null,
): number {
  if (
    typeof orgOverride === "number" &&
    Number.isFinite(orgOverride) &&
    orgOverride > 0
  ) {
    return Math.floor(orgOverride);
  }
  const raw = process.env.EMAIL_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR;
  if (!raw) return DEFAULT_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : DEFAULT_SUPPRESSED_ALERT_THRESHOLD_PER_HOUR;
}

function suppressionKey(orgId: string, hash: string): string {
  return `${orgId}:${hash.toLowerCase()}`;
}

// Task #252 — masked-recipient suppressions are now persisted in
// `email_recipient_suppressions` so they survive deploys/restarts. We
// keep a process-local cache so the synchronous-style read API
// (`isRecipientSuppressed`, `listMaskedRecipientSuppressions`) stays
// fast on the hot send path. The cache is hydrated lazily on the
// first read; mutations always write to the DB first, then update
// the cache. The `since-boot` counters above intentionally reflect
// only this process — they are observability metrics, not durable
// state, and rolling them across restarts would be misleading.
let hydrationPromise: Promise<void> | null = null;

function rowToEntry(row: {
  orgId: string;
  hash: string;
  maskedRecipient: string;
  reason: string;
  addedAt: Date | string;
  addedBy: string | null;
  suppressedSends: number;
  lastSuppressedAt: Date | string | null;
}): MaskedRecipientSuppression {
  const addedAt =
    row.addedAt instanceof Date ? row.addedAt.getTime() : new Date(row.addedAt).getTime();
  const lastSuppressedAt =
    row.lastSuppressedAt == null
      ? null
      : row.lastSuppressedAt instanceof Date
        ? row.lastSuppressedAt.getTime()
        : new Date(row.lastSuppressedAt).getTime();
  return {
    orgId: row.orgId,
    hash: row.hash.toLowerCase(),
    maskedRecipient: row.maskedRecipient,
    reason: row.reason,
    addedAt,
    addedBy: row.addedBy,
    suppressedSends: row.suppressedSends,
    lastSuppressedAt,
  };
}

async function hydrateSuppressionsFromDb(): Promise<void> {
  try {
    const rows = await db.select().from(emailRecipientSuppressions);
    maskedRecipientSuppressions.clear();
    for (const r of rows) {
      const entry = rowToEntry(r);
      maskedRecipientSuppressions.set(suppressionKey(entry.orgId, entry.hash), entry);
    }
  } catch (err) {
    structuredLog({
      level: "error",
      event: "EMAIL_RECIPIENT_SUPPRESSIONS_HYDRATE_FAILED",
      errorCode: redactErrorCode(err),
    });
    // Leave the cache empty; subsequent writes will still attempt to
    // persist and the next read will re-try hydration.
    hydrationPromise = null;
  }
}

async function ensureSuppressionsHydrated(): Promise<void> {
  if (!hydrationPromise) hydrationPromise = hydrateSuppressionsFromDb();
  await hydrationPromise;
}

/**
 * Test-only: drop any cached hydration so the next read re-loads from
 * the DB. Useful for tests that simulate a server restart.
 */
export function resetMaskedRecipientSuppressionCacheForTests(): void {
  hydrationPromise = null;
  maskedRecipientSuppressions.clear();
}

/**
 * Extract the stable 4-char hex hash that `maskRecipient` appends as
 * `(#xxxx)`. Returns lowercased hash or null if the masked string does
 * not match the expected format.
 */
export function extractRecipientHashFromMasked(masked: string | null | undefined): string | null {
  if (!masked) return null;
  const m = String(masked).match(/\(#([a-f0-9]{4})\)\s*$/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Compute the recipient hash that `maskRecipient` would attach for a
 * given raw address. Returns null if no usable address was supplied.
 */
export function recipientHashFor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  return createHash("sha256").update(trimmed.toLowerCase()).digest("hex").slice(0, 4);
}

export async function addMaskedRecipientSuppression(
  orgId: string,
  maskedRecipient: string,
  opts: { reason?: string; addedBy?: string | null } = {},
): Promise<MaskedRecipientSuppression | null> {
  const hash = extractRecipientHashFromMasked(maskedRecipient);
  if (!hash) return null;
  await ensureSuppressionsHydrated();
  const key = suppressionKey(orgId, hash);
  const existing = maskedRecipientSuppressions.get(key);
  if (existing) return { ...existing };

  const reason = opts.reason?.trim() || "manual:admin";
  const addedBy = opts.addedBy ?? null;
  try {
    // ON CONFLICT DO NOTHING covers the race where two admin clicks
    // arrive concurrently — the first row wins; we then read it back
    // so the caller sees the canonical persisted timestamps.
    await db
      .insert(emailRecipientSuppressions)
      .values({ orgId, hash, maskedRecipient, reason, addedBy })
      .onConflictDoNothing();
    const rows = await db
      .select()
      .from(emailRecipientSuppressions)
      .where(
        and(
          eq(emailRecipientSuppressions.orgId, orgId),
          eq(emailRecipientSuppressions.hash, hash),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const entry = rowToEntry(row);
    maskedRecipientSuppressions.set(key, entry);
    return { ...entry };
  } catch (err) {
    structuredLog({
      level: "error",
      event: "EMAIL_RECIPIENT_SUPPRESSION_PERSIST_FAILED",
      orgId,
      errorCode: redactErrorCode(err),
    });
    // Surface the failure: the route returns 500 instead of silently
    // pretending the recipient is suppressed when in fact they aren't.
    throw err;
  }
}

export async function removeMaskedRecipientSuppression(
  orgId: string,
  hash: string,
): Promise<boolean> {
  await ensureSuppressionsHydrated();
  const normalized = hash.toLowerCase();
  try {
    const res = await db
      .delete(emailRecipientSuppressions)
      .where(
        and(
          eq(emailRecipientSuppressions.orgId, orgId),
          eq(emailRecipientSuppressions.hash, normalized),
        ),
      );
    const removedFromCache = maskedRecipientSuppressions.delete(
      suppressionKey(orgId, normalized),
    );
    const dbRemoved =
      typeof (res as { rowCount?: number }).rowCount === "number"
        ? ((res as { rowCount: number }).rowCount ?? 0) > 0
        : removedFromCache;
    return dbRemoved || removedFromCache;
  } catch (err) {
    structuredLog({
      level: "error",
      event: "EMAIL_RECIPIENT_SUPPRESSION_DELETE_FAILED",
      orgId,
      errorCode: redactErrorCode(err),
    });
    throw err;
  }
}

export async function listMaskedRecipientSuppressions(
  orgId: string,
): Promise<MaskedRecipientSuppression[]> {
  await ensureSuppressionsHydrated();
  const out: MaskedRecipientSuppression[] = [];
  for (const entry of maskedRecipientSuppressions.values()) {
    if (entry.orgId === orgId) out.push({ ...entry });
  }
  out.sort((a, b) => b.addedAt - a.addedAt);
  return out;
}

export async function isRecipientSuppressed(
  orgId: string,
  rawRecipient: string | null | undefined,
): Promise<MaskedRecipientSuppression | null> {
  const hash = recipientHashFor(rawRecipient);
  if (!hash) return null;
  await ensureSuppressionsHydrated();
  const entry = maskedRecipientSuppressions.get(suppressionKey(orgId, hash));
  return entry ? { ...entry } : null;
}

/**
 * Record that a send was short-circuited because the recipient is on
 * the masked-recipient suppression list. Tracked separately from
 * transport errors so the "Outgoing email health" panel does not
 * conflate intentional suppressions with infrastructure problems.
 */
// Tracks pending DB writes for suppressed-send counter increments so
// tests can deterministically await persistence.
const pendingSuppressedSendWrites = new Set<Promise<void>>();

function trackPendingSuppressedSendWrite(p: Promise<void>): void {
  const wrapped = p.catch(() => {}).finally(() => {
    pendingSuppressedSendWrites.delete(wrapped);
  });
  pendingSuppressedSendWrites.add(wrapped);
}

/**
 * Test-only: wait for all in-flight suppressed-send counter writes to
 * complete. Counterpart to `flushPendingFailureWebhooksForTests` for
 * the masked-recipient suppression code path.
 */
export async function flushPendingSuppressedSendWritesForTests(): Promise<void> {
  while (pendingSuppressedSendWrites.size > 0) {
    await Promise.all(Array.from(pendingSuppressedSendWrites));
  }
}

export function recordSuppressedSend(
  orgId: string,
  transport: string,
  rawRecipient: string | null | undefined,
): void {
  const hash = recipientHashFor(rawRecipient);
  if (!hash) return;
  const key = suppressionKey(orgId, hash);
  const entry = maskedRecipientSuppressions.get(key);
  if (!entry) return;
  const now = Date.now();
  entry.suppressedSends += 1;
  entry.lastSuppressedAt = now;
  suppressedSendsSinceBoot += 1;
  suppressedSendsByTransport.set(
    transport,
    (suppressedSendsByTransport.get(transport) || 0) + 1,
  );
  const reasonBucket = normalizeSuppressionReason(entry.reason);
  suppressedSendsByReason.set(
    reasonBucket,
    (suppressedSendsByReason.get(reasonBucket) || 0) + 1,
  );
  pruneSuppressedSamples(now);
  suppressedSamples.push({ ts: now, orgId, transport, reason: reasonBucket });
  if (suppressedSamples.length > MAX_SUPPRESSED_SAMPLES) {
    suppressedSamples.splice(0, suppressedSamples.length - MAX_SUPPRESSED_SAMPLES);
  }
  // Persist the counter bump so the per-entry "suppressed sends" stat
  // survives restarts. Fire-and-forget — the cache update above keeps
  // the dashboard responsive even if the DB write is slow, and we log
  // any failure rather than blocking the send-time hot path.
  trackPendingSuppressedSendWrite(
    (async () => {
      try {
        await db
          .update(emailRecipientSuppressions)
          .set({
            suppressedSends: sql`${emailRecipientSuppressions.suppressedSends} + 1`,
            lastSuppressedAt: new Date(now),
          })
          .where(
            and(
              eq(emailRecipientSuppressions.orgId, orgId),
              eq(emailRecipientSuppressions.hash, hash),
            ),
          );
      } catch (err) {
        structuredLog({
          level: "error",
          event: "EMAIL_RECIPIENT_SUPPRESSION_COUNTER_PERSIST_FAILED",
          orgId,
          errorCode: redactErrorCode(err),
        });
      }
    })(),
  );
  structuredLog({
    level: "info",
    event: "EMAIL_SEND_SUPPRESSED",
    orgId,
    transport,
    recipientHash: hash,
  });

  // Task #313 — silenced-send spikes are out-of-band alerted via the
  // same global/org failure webhook used for transport errors, so an
  // accidental bulk-suppress isn't only visible to admins who happen
  // to be staring at the email-health page. Scheduled on the same
  // serialized chain as transport-failure checks so tests can drain
  // both via `flushPendingFailureWebhooksForTests`.
  scheduleSuppressedWebhookCheck(now, orgId);
}

export interface SuppressedSendSummary {
  totalSinceBoot: number;
  byTransport: Record<string, number>;
  byReason: Record<string, number>;
  activeSuppressions: number;
  windowMs: number;
  windowCount: number;
  threshold: { perHour: number; breached: boolean };
}

export function getSuppressedSendSummary(
  orgId?: string,
  opts: { thresholdOverride?: number | null } = {},
): SuppressedSendSummary {
  const now = Date.now();
  pruneSuppressedSamples(now);
  const byTransport: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  let active = 0;
  let windowCount = 0;
  if (orgId) {
    for (const e of maskedRecipientSuppressions.values()) {
      if (e.orgId === orgId) active += 1;
    }
    for (const s of suppressedSamples) {
      if (s.orgId !== orgId) continue;
      windowCount += 1;
      byTransport[s.transport] = (byTransport[s.transport] || 0) + 1;
      byReason[s.reason] = (byReason[s.reason] || 0) + 1;
    }
  } else {
    active = maskedRecipientSuppressions.size;
    for (const [t, n] of suppressedSendsByTransport) byTransport[t] = n;
    for (const [r, n] of suppressedSendsByReason) byReason[r] = n;
    windowCount = suppressedSamples.length;
  }
  const perHour = getSuppressedAlertThresholdPerHour(opts.thresholdOverride);
  return {
    totalSinceBoot: suppressedSendsSinceBoot,
    byTransport,
    byReason,
    activeSuppressions: active,
    windowMs: ROLLING_WINDOW_MS,
    windowCount,
    threshold: { perHour, breached: windowCount >= perHour },
  };
}

const REDACT_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /eyJ[A-Za-z0-9._-]+/g,
  /[A-Za-z0-9_-]{32,}/g,
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
];

export function redactErrorCode(err: unknown): string {
  if (err instanceof MissingMailboxError) return "MISSING_MAILBOX";
  if (!err) return "UNKNOWN";

  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
      ? err
      : "UNKNOWN";

  let scrubbed = raw;
  for (const pat of REDACT_PATTERNS) scrubbed = scrubbed.replace(pat, "***");

  const httpMatch = scrubbed.match(/\((\d{3})\)/);
  if (httpMatch) {
    const tag = scrubbed.toLowerCase().includes("token refresh")
      ? "TOKEN_REFRESH_FAILED"
      : scrubbed.toLowerCase().includes("sendmail")
      ? "SEND_FAILED"
      : "HTTP_ERROR";
    return `${tag}_${httpMatch[1]}`;
  }

  const smtpMatch = scrubbed.match(/\b([45]\d{2})\b\s+([0-9.]+)?/);
  if (smtpMatch) {
    return smtpMatch[2]
      ? `SMTP_${smtpMatch[1]}_${smtpMatch[2]}`
      : `SMTP_${smtpMatch[1]}`;
  }

  if (/invalid .*address|control characters/i.test(scrubbed))
    return "VALIDATION_ERROR";
  if (/decrypt/i.test(scrubbed)) return "DECRYPT_FAILED";
  if (/not configured/i.test(scrubbed)) return "NOT_CONFIGURED";
  if (/timeout|ETIMEDOUT/i.test(scrubbed)) return "TIMEOUT";
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(scrubbed))
    return "NETWORK_ERROR";

  return "UNKNOWN";
}

export function recordEmailFailure(
  orgId: string | undefined,
  transport: string,
  err: unknown,
  recipient?: string | null,
): void {
  const errorCode = redactErrorCode(err);
  const sample: EmailFailureSample = {
    ts: Date.now(),
    orgId: orgId || "none",
    transport,
    errorCode,
    recipient: maskRecipient(recipient),
  };

  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);

  totalsByTransport.set(transport, (totalsByTransport.get(transport) || 0) + 1);
  lastErrorByTransport.set(transport, {
    ts: sample.ts,
    orgId: sample.orgId,
    errorCode,
  });
  totalSinceBoot += 1;

  structuredLog({
    level: "error",
    event: "EMAIL_TRANSPORT_ERROR",
    orgId: sample.orgId,
    transport,
    errorCode,
  });

  scheduleWebhookCheck(sample.ts, sample.orgId);
}

// Task #188: serialize the fire-and-forget webhook checks so tests (and
// any code that needs to read the durable alert log right after a burst
// of failures) can deterministically await the async DB persistence
// step inside `recordAlert`. Without this, the floating promises chain
// async DB inserts that may still be pending when callers read.
let inflightWebhookChain: Promise<void> = Promise.resolve();
const pendingAlertPersists = new Set<Promise<void>>();
function scheduleWebhookCheck(ts: number, orgScope?: string): void {
  inflightWebhookChain = inflightWebhookChain.then(() =>
    maybeSendFailureWebhook(ts, orgScope).catch(() => {
      // Swallow to keep the chain alive; the function itself logs failures.
    }),
  );
}

/**
 * Task #313 — schedule a silenced-send-spike webhook check. Shares the
 * same serialized inflight chain as transport-failure checks so tests
 * can deterministically drain both with `flushPendingFailureWebhooksForTests`.
 */
function scheduleSuppressedWebhookCheck(ts: number, orgScope?: string): void {
  inflightWebhookChain = inflightWebhookChain.then(() =>
    maybeSendSuppressedWebhook(ts, orgScope).catch(() => {
      // Swallow to keep the chain alive; the function itself logs failures.
    }),
  );
}

function trackPendingAlert(p: Promise<void>): void {
  const wrapped = p.catch(() => {}).finally(() => {
    pendingAlertPersists.delete(wrapped);
  });
  pendingAlertPersists.add(wrapped);
}

/**
 * Wait for any in-flight webhook check spawned by `recordEmailFailure`
 * to complete, including the durable DB persistence of any threshold
 * alerts they fire. Test-only: lets tests deterministically observe
 * the durable alert log without racing against the fire-and-forget
 * chain or the async DB insert inside `recordAlert`.
 */
export async function flushPendingFailureWebhooksForTests(): Promise<void> {
  await inflightWebhookChain;
  while (pendingAlertPersists.size > 0) {
    await Promise.all(Array.from(pendingAlertPersists));
  }
}

function pruneSamples(now: number): void {
  const cutoff = now - ROLLING_WINDOW_MS;
  while (samples.length > 0 && samples[0].ts < cutoff) samples.shift();
}

export interface EmailFailureSummary {
  totalSinceBoot: number;
  windowMs: number;
  windowCount: number;
  byTransport: Array<{
    transport: string;
    totalSinceBoot: number;
    windowCount: number;
    lastError: { ts: number; orgId: string; errorCode: string } | null;
  }>;
  recent: EmailFailureSample[];
  threshold: { perHour: number; breached: boolean };
}

export const FAILURE_ALERT_THRESHOLD_PER_HOUR = 10;

/**
 * Build a failure summary. When `orgScope` is provided, only failures
 * tagged with that org id are included — required for the per-tenant
 * admin endpoint so admins of one org cannot see another tenant's
 * operational metadata. When omitted (e.g. internal callers / future
 * cross-tenant alerter), returns global counts.
 */
export function getFailureSummary(orgScope?: string): EmailFailureSummary {
  const now = Date.now();
  pruneSamples(now);

  const scoped = orgScope
    ? samples.filter((s) => s.orgId === orgScope)
    : samples;

  const byTransportMap = new Map<string, number>();
  for (const s of scoped) {
    byTransportMap.set(s.transport, (byTransportMap.get(s.transport) || 0) + 1);
  }

  let byTransport: EmailFailureSummary["byTransport"];
  let totalForResponse: number;

  if (orgScope) {
    const totalsScoped = new Map<
      string,
      { total: number; last: { ts: number; orgId: string; errorCode: string } | null }
    >();
    for (const s of scoped) {
      const t = totalsScoped.get(s.transport) || { total: 0, last: null };
      t.total += 1;
      if (!t.last || s.ts >= t.last.ts) {
        t.last = { ts: s.ts, orgId: s.orgId, errorCode: s.errorCode };
      }
      totalsScoped.set(s.transport, t);
    }
    byTransport = Array.from(totalsScoped.entries()).map(([transport, v]) => ({
      transport,
      totalSinceBoot: v.total,
      windowCount: byTransportMap.get(transport) || 0,
      lastError: v.last,
    }));
    totalForResponse = scoped.length;
  } else {
    const transports = new Set<string>([
      ...totalsByTransport.keys(),
      ...byTransportMap.keys(),
    ]);
    byTransport = Array.from(transports).map((t) => ({
      transport: t,
      totalSinceBoot: totalsByTransport.get(t) || 0,
      windowCount: byTransportMap.get(t) || 0,
      lastError: lastErrorByTransport.get(t) || null,
    }));
    totalForResponse = totalSinceBoot;
  }

  const windowCount = scoped.length;
  return {
    totalSinceBoot: totalForResponse,
    windowMs: ROLLING_WINDOW_MS,
    windowCount,
    byTransport,
    recent: scoped.slice(-50),
    threshold: {
      perHour: FAILURE_ALERT_THRESHOLD_PER_HOUR,
      breached: windowCount >= FAILURE_ALERT_THRESHOLD_PER_HOUR,
    },
  };
}

export interface FailureWebhookAlertRecord {
  ts: number;
  failureCount: number;
  threshold: number;
  thresholdBreached: boolean;
  topTransport: string | null;
  topErrorCode: string | null;
  delivered: boolean;
  /**
   * Task #313 — discriminator: 'transport_failure' is the original
   * transport-error breach; 'suppressed_spike' is fired when the
   * silenced-send (suppression-list short-circuit) per-hour threshold
   * is crossed and the configured webhook is notified out-of-band.
   * Defaults to 'transport_failure' so older callers stay compatible.
   */
  alertKind: EmailFailureAlertKind;
  /**
   * Per-org breakdown copied from the durable `by_org` jsonb. Only
   * populated when the caller passes `includeByOrg: true` and is not
   * scoped to a single org (i.e. cross-tenant operator view). Tenant
   * admins must never receive this — the route that exposes it is
   * gated by the platform-operator check.
   */
  byOrg?: Record<string, EmailFailureAlertOrgSlice>;
}

interface StoredFailureAlert
  extends Omit<FailureWebhookAlertRecord, "byOrg"> {
  byOrg: Map<string, EmailFailureAlertOrgSlice>;
}

/**
 * Hard upper bound on the page size accepted by `listFailureAlerts`.
 * The dashboard pages 10 alerts at a time; this ceiling exists only
 * so the CSV export path (and any future bulk consumer) can request
 * far more in one call without an admin being able to ask for a
 * pathological page like `limit=10000000`. Age-based retention
 * (`pruneOldFailureAlerts`) is the actual bound on durable storage,
 * so this constant no longer caps the total history kept on file.
 */
const MAX_ALERT_PAGE_SIZE_DB = 10_000;

/**
 * Default age-based retention window. Anything older than this is
 * deleted by `pruneOldFailureAlerts`. This is the only operational
 * cap on the durable alert log — Task #283 removed the previous
 * 200-row post-insert prune so admins can export every alert in the
 * active retention window. Override via the
 * `EMAIL_FAILURE_ALERT_RETENTION_DAYS` env var.
 */
const DEFAULT_ALERT_RETENTION_DAYS = 30;

export function getAlertRetentionDays(): number {
  const raw = process.env.EMAIL_FAILURE_ALERT_RETENTION_DAYS;
  if (!raw) return DEFAULT_ALERT_RETENTION_DAYS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_ALERT_RETENTION_DAYS;
}

/**
 * Delete `email_failure_alerts` rows older than the configured retention
 * window (default 30 days). Returns the number of rows deleted. Failures
 * are logged but never thrown — this is best-effort housekeeping that
 * must not break the caller.
 */
export async function pruneOldFailureAlerts(
  now: number = Date.now(),
): Promise<{ deleted: number; retentionDays: number; cutoff: Date }> {
  const retentionDays = getAlertRetentionDays();
  const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1000);
  try {
    const res = await db.execute(sql`
      DELETE FROM email_failure_alerts WHERE ts < ${cutoff}
    `);
    const deleted =
      typeof (res as { rowCount?: number }).rowCount === "number"
        ? ((res as { rowCount: number }).rowCount ?? 0)
        : 0;
    return { deleted, retentionDays, cutoff };
  } catch (err) {
    structuredLog({
      level: "error",
      event: "EMAIL_FAILURE_ALERT_PRUNE_FAILED",
      errorCode: redactErrorCode(err),
    });
    return { deleted: 0, retentionDays, cutoff };
  }
}

/**
 * Default age-based retention window for masked-recipient suppressions.
 * Suppressions whose `last_suppressed_at` (or `added_at` if never re-hit)
 * is older than this are auto-removed by `pruneStaleRecipientSuppressions`.
 * Override via the `EMAIL_RECIPIENT_SUPPRESSION_RETENTION_DAYS` env var.
 */
const DEFAULT_RECIPIENT_SUPPRESSION_RETENTION_DAYS = 90;

export function getRecipientSuppressionRetentionDays(): number {
  const raw = process.env.EMAIL_RECIPIENT_SUPPRESSION_RETENTION_DAYS;
  if (!raw) return DEFAULT_RECIPIENT_SUPPRESSION_RETENTION_DAYS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0
    ? n
    : DEFAULT_RECIPIENT_SUPPRESSION_RETENTION_DAYS;
}

/**
 * Task #276 — Auto-expire stale `email_recipient_suppressions` rows
 * whose effective last activity (COALESCE(last_suppressed_at, added_at))
 * is older than the configured window (default 90 days). Mirrors the
 * `pruneOldFailureAlerts` pattern: best-effort, never throws, returns
 * the number of rows deleted along with the cutoff used.
 *
 * Each removed suppression is recorded in `audit_logs` with action
 * `EMAIL_RECIPIENT_SUPPRESSION_AUTO_EXPIRED` so admins can trace why
 * a previously-silenced recipient started receiving mail again. Audit
 * inserts are themselves best-effort — a single bad row (e.g. orgId
 * no longer in `orgs`) must not abort the rest of the sweep.
 */
export async function pruneStaleRecipientSuppressions(
  now: number = Date.now(),
): Promise<{ deleted: number; retentionDays: number; cutoff: Date }> {
  const retentionDays = getRecipientSuppressionRetentionDays();
  const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1000);
  try {
    // Atomic delete-with-RETURNING so cache eviction + audit entries
    // only fire for rows actually removed. A separate SELECT-then-DELETE
    // is racy: a concurrent `recordSuppressedSend` could bump
    // `last_suppressed_at` between the two statements, leaving the row
    // in the DB while we'd still drop it from the in-memory cache —
    // which would silently re-enable mail to a chronic failing
    // recipient until the next process restart re-hydrates the cache.
    const res = await db.execute<{
      org_id: string;
      hash: string;
      masked_recipient: string;
      reason: string;
      added_at: Date | string;
      last_suppressed_at: Date | string | null;
      suppressed_sends: number;
    }>(sql`
      DELETE FROM email_recipient_suppressions
      WHERE COALESCE(last_suppressed_at, added_at) < ${cutoff}
      RETURNING org_id, hash, masked_recipient, reason,
                added_at, last_suppressed_at, suppressed_sends
    `);
    const returnedRows = (res as unknown as {
      rows?: Array<{
        org_id: string;
        hash: string;
        masked_recipient: string;
        reason: string;
        added_at: Date | string;
        last_suppressed_at: Date | string | null;
        suppressed_sends: number;
      }>;
    }).rows ?? [];
    const stale = returnedRows.map((r) => ({
      orgId: r.org_id,
      hash: r.hash,
      maskedRecipient: r.masked_recipient,
      reason: r.reason,
      addedAt: r.added_at,
      lastSuppressedAt: r.last_suppressed_at,
      suppressedSends: r.suppressed_sends,
    }));
    const deleted = stale.length;
    if (deleted === 0) {
      return { deleted: 0, retentionDays, cutoff };
    }

    for (const row of stale) {
      maskedRecipientSuppressions.delete(
        suppressionKey(row.orgId, row.hash.toLowerCase()),
      );
    }

    for (const row of stale) {
      const addedAtIso =
        row.addedAt instanceof Date
          ? row.addedAt.toISOString()
          : new Date(row.addedAt as unknown as string).toISOString();
      const lastSuppressedAtIso = row.lastSuppressedAt
        ? row.lastSuppressedAt instanceof Date
          ? row.lastSuppressedAt.toISOString()
          : new Date(row.lastSuppressedAt as unknown as string).toISOString()
        : null;
      try {
        await db.insert(auditLogs).values({
          orgId: row.orgId,
          userId: null,
          action: "EMAIL_RECIPIENT_SUPPRESSION_AUTO_EXPIRED",
          entityType: "email_recipient_suppression",
          entityId: row.hash,
          details: {
            maskedRecipient: row.maskedRecipient,
            reason: row.reason,
            addedAt: addedAtIso,
            lastSuppressedAt: lastSuppressedAtIso,
            suppressedSends: row.suppressedSends,
            retentionDays,
            cutoff: cutoff.toISOString(),
          },
        });
      } catch (err) {
        structuredLog({
          level: "error",
          event: "EMAIL_RECIPIENT_SUPPRESSION_AUDIT_FAILED",
          orgId: row.orgId,
          errorCode: redactErrorCode(err),
        });
      }
    }

    structuredLog({
      level: "info",
      event: "EMAIL_RECIPIENT_SUPPRESSION_PRUNED",
      deleted,
      retentionDays,
    });

    return { deleted, retentionDays, cutoff };
  } catch (err) {
    structuredLog({
      level: "error",
      event: "EMAIL_RECIPIENT_SUPPRESSION_PRUNE_FAILED",
      errorCode: redactErrorCode(err),
    });
    return { deleted: 0, retentionDays, cutoff };
  }
}

/**
 * Default 24h interval between recipient-suppression sweeps. Mirrors the
 * cadence the boot wiring in `server/index.ts` previously inlined and
 * keeps the constant in one place so tests can override it.
 */
export const RECIPIENT_SUPPRESSION_CLEANUP_INTERVAL_MS = 24 * 60 * 60_000;

export interface RecipientSuppressionCleanupSchedulerHandle {
  /**
   * Resolves with the result of the boot-time sweep, or `null` when the
   * caller passed `runImmediately: false`. Tests can `await` this to
   * confirm the boot sweep completed before making assertions.
   */
  initialRun: Promise<{
    deleted: number;
    retentionDays: number;
    cutoff: Date;
  } | null>;
  stop: () => void;
}

let recipientSuppressionCleanupInterval:
  | ReturnType<typeof setInterval>
  | null = null;

/**
 * Task #312 — Factory for the recipient-suppression auto-expiry sweep
 * wiring used by `server/index.ts`. Centralising the boot call + 24h
 * interval here lets integration tests exercise the same orchestration
 * the production server uses (instead of asserting against the
 * underlying helper directly).
 *
 * Behavioural contract:
 *  - Calls `pruneStaleRecipientSuppressions` once on startup (skip with
 *    `runImmediately: false`) and again on every `intervalMs` tick.
 *  - Logs at `[email-recipient-suppression-cleanup]` when rows are
 *    actually deleted, matching the previous inline behaviour.
 *  - Swallows errors from individual sweeps so a transient DB blip
 *    doesn't take down the process.
 *  - Multiple calls replace the active interval (the previous one is
 *    cleared first) — important when the dev server restarts under
 *    nodemon/vitest.
 *  - The interval is `unref()`d so it never blocks process exit on its
 *    own.
 */
export function startRecipientSuppressionCleanupScheduler(opts?: {
  intervalMs?: number;
  runImmediately?: boolean;
}): RecipientSuppressionCleanupSchedulerHandle {
  const intervalMs =
    opts?.intervalMs ?? RECIPIENT_SUPPRESSION_CLEANUP_INTERVAL_MS;
  const runImmediately = opts?.runImmediately ?? true;

  const runOnce = async (): Promise<{
    deleted: number;
    retentionDays: number;
    cutoff: Date;
  } | null> => {
    try {
      const stats = await pruneStaleRecipientSuppressions();
      if (stats.deleted > 0) {
        console.log(
          `[email-recipient-suppression-cleanup] deleted=${stats.deleted} retentionDays=${stats.retentionDays} cutoff=${stats.cutoff.toISOString()}`,
        );
      }
      return stats;
    } catch (e) {
      console.error(
        "[email-recipient-suppression-cleanup] Sweep failed:",
        e,
      );
      return null;
    }
  };

  const initialRun = runImmediately ? runOnce() : Promise.resolve(null);

  if (recipientSuppressionCleanupInterval) {
    clearInterval(recipientSuppressionCleanupInterval);
  }
  recipientSuppressionCleanupInterval = setInterval(() => {
    runOnce();
  }, intervalMs);
  recipientSuppressionCleanupInterval.unref?.();

  return {
    initialRun,
    stop: () => stopRecipientSuppressionCleanupScheduler(),
  };
}

export function stopRecipientSuppressionCleanupScheduler(): void {
  if (recipientSuppressionCleanupInterval) {
    clearInterval(recipientSuppressionCleanupInterval);
    recipientSuppressionCleanupInterval = null;
  }
}

async function recordAlert(rec: StoredFailureAlert): Promise<void> {
  const byOrgObj: Record<string, EmailFailureAlertOrgSlice> = {};
  for (const [orgId, slice] of rec.byOrg) byOrgObj[orgId] = slice;

  try {
    await db.insert(emailFailureAlerts).values({
      ts: new Date(rec.ts),
      failureCount: rec.failureCount,
      threshold: rec.threshold,
      thresholdBreached: rec.thresholdBreached,
      topTransport: rec.topTransport,
      topErrorCode: rec.topErrorCode,
      delivered: rec.delivered,
      byOrg: byOrgObj,
      alertKind: rec.alertKind,
    });
    // Time-based retention: drop anything older than the configured
    // window (default 30 days) so very old alerts don't linger across
    // long-running deployments with infrequent breaches. Delegates to
    // the shared helper so the cutoff logic lives in one place.
    //
    // Task #283 — the previous post-insert "keep only the most recent
    // MAX rows" prune was removed so admins can export every alert in
    // the active retention window. The 15-minute alert cooldown plus
    // 30-day retention puts a hard ceiling on row count regardless.
    await pruneOldFailureAlerts(rec.ts);
  } catch (err) {
    structuredLog({
      level: "error",
      event: "EMAIL_FAILURE_ALERT_PERSIST_FAILED",
      errorCode: redactErrorCode(err),
    });
  }
}

/**
 * Recent threshold-breach alerts. When `orgScope` is provided, only
 * alerts where that org contributed at least one failure are returned,
 * and the per-alert `failureCount` / `topTransport` / `topErrorCode`
 * are projected to that org's slice (mirrors the per-tenant scoping
 * applied by `getFailureSummary(orgScope)`). Without an `orgScope`,
 * the global view is returned (intended for internal callers, never
 * tenant-facing routes).
 *
 * Task #188 — alerts are now read from the durable
 * `email_failure_alerts` table so the dashboard's history survives
 * server restarts. If the read fails for any reason (e.g. table not yet
 * migrated on a fresh dev DB), we return an empty list rather than
 * crashing the admin dashboard.
 */
export async function getRecentFailureAlerts(
  limit = 5,
  orgScope?: string,
): Promise<FailureWebhookAlertRecord[]> {
  const page = await listFailureAlerts({ limit, orgScope });
  return page.alerts;
}

export interface ListFailureAlertsOptions {
  limit?: number;
  offset?: number;
  orgScope?: string;
  /** Inclusive lower bound (epoch ms). */
  fromMs?: number | null;
  /** Inclusive upper bound (epoch ms). */
  toMs?: number | null;
  /**
   * If true and `orgScope` is undefined, attach the per-org breakdown
   * (`byOrg`) to each returned alert so a cross-tenant operator can
   * see which orgs were affected. Ignored when `orgScope` is set —
   * tenant admins must not receive other orgs' data.
   */
  includeByOrg?: boolean;
  /**
   * Task #283 — return every matching alert (ignoring `limit`/`offset`)
   * so the CSV export can include the full record. Used by the bulk
   * export route; the dashboard always passes a finite `limit`.
   */
  noLimit?: boolean;
}

export interface ListFailureAlertsResult {
  alerts: FailureWebhookAlertRecord[];
  total: number;
}

/**
 * Paginated, date-filtered read of the durable failure-alert history.
 * When `orgScope` is provided, only alerts where that org contributed
 * at least one failure are counted/returned, and per-alert fields are
 * projected to that org's slice. Both `total` and `alerts` honor the
 * same filters so the UI can build a stable pagination control.
 */
export async function listFailureAlerts(
  opts: ListFailureAlertsOptions = {},
): Promise<ListFailureAlertsResult> {
  const limit = Math.max(
    1,
    Math.min(MAX_ALERT_PAGE_SIZE_DB, Math.floor(opts.limit ?? 5)),
  );
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const noLimit = !!opts.noLimit;
  const fromMs =
    typeof opts.fromMs === "number" && Number.isFinite(opts.fromMs)
      ? opts.fromMs
      : null;
  const toMs =
    typeof opts.toMs === "number" && Number.isFinite(opts.toMs)
      ? opts.toMs
      : null;
  const orgScope = opts.orgScope;

  try {
    const conds: SQL[] = [];
    if (fromMs !== null) conds.push(gte(emailFailureAlerts.ts, new Date(fromMs)));
    if (toMs !== null) conds.push(lte(emailFailureAlerts.ts, new Date(toMs)));
    const where: SQL | undefined =
      conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

    const baseQuery = db.select().from(emailFailureAlerts);
    const filtered = where ? baseQuery.where(where) : baseQuery;
    const rows = await filtered.orderBy(desc(emailFailureAlerts.ts));

    const projected: FailureWebhookAlertRecord[] = [];
    for (const r of rows) {
      const tsMs =
        r.ts instanceof Date
          ? r.ts.getTime()
          : new Date(r.ts as unknown as string).getTime();
      const byOrg = (r.byOrg ?? {}) as Record<string, EmailFailureAlertOrgSlice>;
      const kind: EmailFailureAlertKind =
        (r.alertKind as EmailFailureAlertKind | null | undefined) ??
        "transport_failure";
      if (orgScope) {
        // Both alert kinds write a per-org slice in `by_org` keyed by
        // the affected org id, so the same projection logic works for
        // either: skip alerts where this tenant did not contribute.
        const slice = byOrg[orgScope];
        if (!slice) continue;
        projected.push({
          ts: tsMs,
          threshold: r.threshold,
          thresholdBreached: slice.failureCount >= r.threshold,
          delivered: r.delivered,
          failureCount: slice.failureCount,
          topTransport: slice.topTransport,
          topErrorCode: slice.topErrorCode,
          alertKind: kind,
        });
      } else {
        const rec: FailureWebhookAlertRecord = {
          ts: tsMs,
          threshold: r.threshold,
          thresholdBreached: r.thresholdBreached,
          delivered: r.delivered,
          failureCount: r.failureCount,
          topTransport: r.topTransport,
          topErrorCode: r.topErrorCode,
          alertKind: kind,
        };
        if (opts.includeByOrg) rec.byOrg = byOrg;
        projected.push(rec);
      }
    }

    const total = projected.length;
    const alerts = noLimit ? projected : projected.slice(offset, offset + limit);
    return { alerts, total };
  } catch (err) {
    structuredLog({
      level: "error",
      event: "EMAIL_FAILURE_ALERT_READ_FAILED",
      errorCode: redactErrorCode(err),
    });
    return { alerts: [], total: 0 };
  }
}

export async function resetFailureTrackerForTests(): Promise<void> {
  // Drain any in-flight webhook chain so a previously-pending DB insert
  // doesn't repopulate the table after we delete from it.
  await inflightWebhookChain.catch(() => {});
  inflightWebhookChain = Promise.resolve();
  if (pendingAlertPersists.size > 0) {
    await Promise.all(Array.from(pendingAlertPersists));
  }
  if (pendingSuppressedSendWrites.size > 0) {
    await Promise.all(Array.from(pendingSuppressedSendWrites));
  }
  samples.length = 0;
  totalsByTransport.clear();
  lastErrorByTransport.clear();
  totalSinceBoot = 0;
  maskedRecipientSuppressions.clear();
  hydrationPromise = null;
  suppressedSendsByTransport.clear();
  suppressedSendsByReason.clear();
  suppressedSendsSinceBoot = 0;
  suppressedSamples.length = 0;
  lastWebhookSentAt = 0;
  lastSuppressedWebhookSentAtGlobal = 0;
  lastSuppressedWebhookSentAtPerOrg.clear();
  webhookFetcherOverride = null;
  orgWebhookConfigs.clear();
  lastOrgWebhookSentAt.clear();
  try {
    await db.delete(emailFailureAlerts);
  } catch {
    // Table may not exist in environments where the migration hasn't
    // been replayed yet; the in-memory reset above is still useful.
  }
  try {
    await db.delete(emailRecipientSuppressions);
  } catch {
    // Same: tolerate environments where the migration hasn't run yet.
  }
  try {
    await db.delete(emailAlertPinnedOrgs);
  } catch {
    // Same: tolerate environments where the migration hasn't run yet.
  }
}

const DEFAULT_WEBHOOK_COOLDOWN_MS = 15 * 60 * 1000;
let lastWebhookSentAt = 0;

/**
 * Task #313 — independent cooldown timers for the silenced-send-spike
 * webhook so a transport-failure burst does not silence a concurrent
 * suppression spike (and vice-versa). Same default cooldown as the
 * transport-failure webhook.
 */
let lastSuppressedWebhookSentAtGlobal = 0;
const lastSuppressedWebhookSentAtPerOrg = new Map<string, number>();

export interface OrgFailureWebhookConfig {
  url: string;
  cooldownMs?: number | null;
}

const orgWebhookConfigs = new Map<string, OrgFailureWebhookConfig>();
const lastOrgWebhookSentAt = new Map<string, number>();

export function setOrgFailureWebhookConfig(
  orgId: string,
  config: OrgFailureWebhookConfig,
): void {
  orgWebhookConfigs.set(orgId, {
    url: config.url,
    cooldownMs:
      typeof config.cooldownMs === "number" && config.cooldownMs >= 0
        ? config.cooldownMs
        : null,
  });
  lastOrgWebhookSentAt.delete(orgId);
  lastSuppressedWebhookSentAtPerOrg.delete(orgId);
}

export function clearOrgFailureWebhookConfig(orgId: string): void {
  orgWebhookConfigs.delete(orgId);
  lastOrgWebhookSentAt.delete(orgId);
  lastSuppressedWebhookSentAtPerOrg.delete(orgId);
}

export function getOrgFailureWebhookConfig(
  orgId: string,
): OrgFailureWebhookConfig | null {
  return orgWebhookConfigs.get(orgId) ?? null;
}

export interface FailureWebhookTopOrg {
  orgId: string;
  name: string | null;
  failureCount: number;
  /**
   * Task #280 — true when this org appears in the breakdown only
   * because it is on the operator-curated pinned list. Surfaced so
   * the chat payload can mark the row (and so tests can assert the
   * pinning actually fired vs. the org happening to make the cut on
   * its own).
   */
  pinned?: boolean;
}

export interface PinnedAlertOrg {
  orgId: string;
  pinnedAt: number;
  pinnedBy: string | null;
  note: string | null;
}

function pinnedRowToEntry(row: {
  orgId: string;
  pinnedAt: Date | string;
  pinnedBy: string | null;
  note: string | null;
}): PinnedAlertOrg {
  const pinnedAt =
    row.pinnedAt instanceof Date
      ? row.pinnedAt.getTime()
      : new Date(row.pinnedAt).getTime();
  return {
    orgId: row.orgId,
    pinnedAt,
    pinnedBy: row.pinnedBy,
    note: row.note,
  };
}

/**
 * Task #280 — return the operator-curated set of orgs that should be
 * forced into the cross-tenant alert breakdown when they contributed
 * any failures. Failures are swallowed (returning an empty list) so a
 * transient DB hiccup never blocks the webhook from firing — pinning
 * is best-effort enrichment, not a correctness requirement.
 */
export async function listPinnedAlertOrgs(): Promise<PinnedAlertOrg[]> {
  try {
    const rows = await db
      .select()
      .from(emailAlertPinnedOrgs)
      .orderBy(desc(emailAlertPinnedOrgs.pinnedAt));
    return rows.map(pinnedRowToEntry);
  } catch (err) {
    structuredLog({
      level: "error",
      event: "EMAIL_ALERT_PINNED_ORGS_READ_FAILED",
      errorCode: redactErrorCode(err),
    });
    return [];
  }
}

export async function addPinnedAlertOrg(
  orgId: string,
  opts: { pinnedBy?: string | null; note?: string | null } = {},
): Promise<PinnedAlertOrg | null> {
  const trimmed = orgId.trim();
  if (!trimmed) return null;
  const note = opts.note?.trim() ? opts.note.trim() : null;
  const pinnedBy = opts.pinnedBy ?? null;
  try {
    await db
      .insert(emailAlertPinnedOrgs)
      .values({ orgId: trimmed, pinnedBy, note })
      .onConflictDoNothing();
    const rows = await db
      .select()
      .from(emailAlertPinnedOrgs)
      .where(eq(emailAlertPinnedOrgs.orgId, trimmed))
      .limit(1);
    const row = rows[0];
    return row ? pinnedRowToEntry(row) : null;
  } catch (err) {
    structuredLog({
      level: "error",
      event: "EMAIL_ALERT_PINNED_ORG_PERSIST_FAILED",
      orgId: trimmed,
      errorCode: redactErrorCode(err),
    });
    throw err;
  }
}

export async function removePinnedAlertOrg(orgId: string): Promise<boolean> {
  const trimmed = orgId.trim();
  if (!trimmed) return false;
  try {
    // Use RETURNING so the result is unambiguous regardless of which
    // pg driver is in play — `rowCount` falls back to undefined on
    // some drivers, which would otherwise force us to optimistically
    // report removal when nothing was deleted.
    const removed = await db
      .delete(emailAlertPinnedOrgs)
      .where(eq(emailAlertPinnedOrgs.orgId, trimmed))
      .returning({ orgId: emailAlertPinnedOrgs.orgId });
    return removed.length > 0;
  } catch (err) {
    structuredLog({
      level: "error",
      event: "EMAIL_ALERT_PINNED_ORG_DELETE_FAILED",
      orgId: trimmed,
      errorCode: redactErrorCode(err),
    });
    throw err;
  }
}

export interface FailureWebhookPayload {
  text: string;
  failureCount: number;
  windowMs: number;
  threshold: number;
  topTransport: string | null;
  topErrorCode: string | null;
  /**
   * Top affected orgs for the alert window, sorted by failureCount desc.
   * Only populated when more than one org contributed to the breach so
   * single-org alerts produce the same compact message they always have.
   */
  topOrgs?: FailureWebhookTopOrg[];
  /**
   * Task #313 — distinguishes the silenced-send-spike payload from the
   * original transport-failure breach payload so consumers
   * (Slack-style channels, downstream automations, tests) can branch
   * on it. Defaults to 'transport_failure' to preserve the existing
   * payload shape for unchanged callers.
   */
  alertKind?: EmailFailureAlertKind;
  /**
   * Task #313 — relative URL the chat message links back to so admins
   * can jump straight to the Suppressed tab on the email-health page.
   * Only populated for suppressed-send-spike alerts.
   */
  suppressionsUrl?: string;
}

type WebhookFetcher = (
  url: string,
  payload: FailureWebhookPayload,
) => Promise<void>;

let webhookFetcherOverride: WebhookFetcher | null = null;

export function setFailureWebhookFetcherForTests(
  fetcher: WebhookFetcher | null,
): void {
  webhookFetcherOverride = fetcher;
}

function getCooldownMs(): number {
  const raw = process.env.EMAIL_FAILURE_WEBHOOK_COOLDOWN_MS;
  if (!raw) return DEFAULT_WEBHOOK_COOLDOWN_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_WEBHOOK_COOLDOWN_MS;
}

/**
 * Maximum number of affected orgs to surface in the webhook payload.
 * Triagers in Slack only need a quick "who is hit hardest" snapshot —
 * the dashboard is the place to see the full breakdown.
 */
const MAX_TOP_ORGS_IN_PAYLOAD = 5;

function buildPayload(
  failureCount: number,
  topTransport: string | null,
  topErrorCode: string | null,
  topOrgs?: FailureWebhookTopOrg[] | null,
  pinnedOrgIds?: Set<string> | null,
): FailureWebhookPayload {
  let text =
    `:rotating_light: Outgoing email failure threshold breached: ` +
    `${failureCount} failure${failureCount === 1 ? "" : "s"} in the last hour ` +
    `(threshold ${FAILURE_ALERT_THRESHOLD_PER_HOUR}). ` +
    `Top transport: ${topTransport ?? "unknown"}. ` +
    `Top error: ${topErrorCode ?? "unknown"}.`;

  // Single-org alerts keep the original compact one-liner. We only
  // append the per-org breakdown when more than one org contributed to
  // the breach so cross-tenant operators can triage from chat without
  // bouncing to the dashboard.
  const payload: FailureWebhookPayload = {
    text,
    failureCount,
    windowMs: ROLLING_WINDOW_MS,
    threshold: FAILURE_ALERT_THRESHOLD_PER_HOUR,
    topTransport,
    topErrorCode,
  };

  if (topOrgs && topOrgs.length > 1) {
    const head = topOrgs.slice(0, MAX_TOP_ORGS_IN_PAYLOAD);
    // Task #280 — splice in any pinned orgs that contributed failures
    // but didn't make the natural top-5 cut. Order: organic top-N
    // first (preserving the by-failure-count ranking the operator
    // expects), then pinned extras sorted by their own failure count
    // desc so the highest-impact pinned org appears first.
    const trimmed: FailureWebhookTopOrg[] = head.map((o) => ({
      ...o,
      pinned: pinnedOrgIds?.has(o.orgId) ? true : o.pinned,
    }));
    if (pinnedOrgIds && pinnedOrgIds.size > 0) {
      const inTrimmed = new Set(trimmed.map((o) => o.orgId));
      const extras = topOrgs
        .filter((o) => pinnedOrgIds.has(o.orgId) && !inTrimmed.has(o.orgId))
        .map((o) => ({ ...o, pinned: true }));
      if (extras.length > 0) trimmed.push(...extras);
    }
    const parts = trimmed.map(
      (o) =>
        `${o.name ?? o.orgId} (${o.failureCount} failure${
          o.failureCount === 1 ? "" : "s"
        })${o.pinned ? " 📌" : ""}`,
    );
    const remaining = topOrgs.length - trimmed.length;
    const suffix = remaining > 0 ? ` (+${remaining} more)` : "";
    text += ` Top affected orgs: ${parts.join(", ")}${suffix}.`;
    payload.text = text;
    payload.topOrgs = trimmed;
  }

  return payload;
}

/**
 * Look up display names for the given org ids. Failures are swallowed
 * (returning an empty map) so a transient DB hiccup never prevents the
 * webhook from firing — operators still get the alert, just without
 * friendly names.
 */
async function fetchOrgNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  try {
    const result = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM orgs WHERE id = ANY($1::text[])`,
      [ids],
    );
    for (const row of result.rows) out.set(row.id, row.name);
  } catch (err) {
    structuredLog({
      level: "error",
      event: "EMAIL_FAILURE_WEBHOOK_ORG_NAME_LOOKUP_FAILED",
      errorCode: redactErrorCode(err),
    });
  }
  return out;
}

async function topOrgsFromBreakdown(
  byOrg: Map<
    string,
    { failureCount: number; topTransport: string | null; topErrorCode: string | null }
  >,
): Promise<FailureWebhookTopOrg[]> {
  const entries = Array.from(byOrg.entries())
    .filter(([orgId]) => orgId && orgId !== "none")
    .sort((a, b) => b[1].failureCount - a[1].failureCount);
  if (entries.length === 0) return [];
  const ids = entries.map(([orgId]) => orgId);
  const names = await fetchOrgNames(ids);
  return entries.map(([orgId, slice]) => ({
    orgId,
    name: names.get(orgId) ?? null,
    failureCount: slice.failureCount,
  }));
}

/**
 * Task #280 — read the operator-curated pinned-org set as a Set for
 * cheap membership checks during payload composition. Returns an empty
 * set on read failure (errors are already logged in `listPinnedAlertOrgs`).
 */
async function loadPinnedAlertOrgIds(): Promise<Set<string>> {
  const entries = await listPinnedAlertOrgs();
  return new Set(entries.map((e) => e.orgId));
}

async function defaultWebhookFetcher(
  url: string,
  payload: FailureWebhookPayload,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Webhook responded with HTTP ${res.status}`);
  }
}

function topsForSamples(
  scoped: EmailFailureSample[],
): { topTransport: string | null; topErrorCode: string | null } {
  const transportCounts = new Map<string, number>();
  const errorCodeCounts = new Map<string, number>();
  for (const s of scoped) {
    transportCounts.set(s.transport, (transportCounts.get(s.transport) || 0) + 1);
    errorCodeCounts.set(s.errorCode, (errorCodeCounts.get(s.errorCode) || 0) + 1);
  }
  return {
    topTransport:
      [...transportCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    topErrorCode:
      [...errorCodeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
}

function logAlertDelivered(
  payload: FailureWebhookPayload,
  scope: { kind: "global" } | { kind: "org"; orgId: string },
): void {
  structuredLog({
    level: "info",
    event: "EMAIL_FAILURE_WEBHOOK_SENT",
    scope: scope.kind,
    orgId: scope.kind === "org" ? scope.orgId : undefined,
    failureCount: payload.failureCount,
    topTransport: payload.topTransport,
    topErrorCode: payload.topErrorCode,
  });
}

function logAlertFailed(
  err: unknown,
  scope: { kind: "global" } | { kind: "org"; orgId: string },
): void {
  structuredLog({
    level: "error",
    event: "EMAIL_FAILURE_WEBHOOK_FAILED",
    scope: scope.kind,
    orgId: scope.kind === "org" ? scope.orgId : undefined,
    errorCode: redactErrorCode(err),
  });
}

function buildByOrgBreakdown(
  source: EmailFailureSample[],
): Map<
  string,
  { failureCount: number; topTransport: string | null; topErrorCode: string | null }
> {
  const byOrg = new Map<
    string,
    { failureCount: number; topTransport: string | null; topErrorCode: string | null }
  >();
  const orgTransportCounts = new Map<string, Map<string, number>>();
  const orgErrorCodeCounts = new Map<string, Map<string, number>>();
  for (const s of source) {
    if (!s.orgId) continue;
    const t = orgTransportCounts.get(s.orgId) ?? new Map<string, number>();
    t.set(s.transport, (t.get(s.transport) || 0) + 1);
    orgTransportCounts.set(s.orgId, t);
    const e = orgErrorCodeCounts.get(s.orgId) ?? new Map<string, number>();
    e.set(s.errorCode, (e.get(s.errorCode) || 0) + 1);
    orgErrorCodeCounts.set(s.orgId, e);
    const cur = byOrg.get(s.orgId) ?? {
      failureCount: 0,
      topTransport: null as string | null,
      topErrorCode: null as string | null,
    };
    cur.failureCount += 1;
    byOrg.set(s.orgId, cur);
  }
  for (const [orgId, agg] of byOrg) {
    agg.topTransport =
      [...(orgTransportCounts.get(orgId) ?? new Map<string, number>()).entries()].sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0] ?? null;
    agg.topErrorCode =
      [...(orgErrorCodeCounts.get(orgId) ?? new Map<string, number>()).entries()].sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0] ?? null;
  }
  return byOrg;
}

/**
 * Send a synthetic test payload to a webhook URL using the same fetcher
 * the real failure alerts use (so tests can intercept it). Throws if the
 * remote returns a non-2xx or fetch otherwise fails.
 */
export async function sendFailureWebhookTest(
  url: string,
  scope: { kind: "global" } | { kind: "org"; orgId: string },
): Promise<FailureWebhookPayload> {
  const text =
    `:white_check_mark: Test alert from your outgoing-email failure webhook. ` +
    `If you can read this in Slack, your URL is correct. ` +
    `(No real failures have occurred — this was sent manually.)`;
  const payload: FailureWebhookPayload = {
    text,
    failureCount: 0,
    windowMs: ROLLING_WINDOW_MS,
    threshold: FAILURE_ALERT_THRESHOLD_PER_HOUR,
    topTransport: null,
    topErrorCode: null,
  };
  const fetcher = webhookFetcherOverride ?? defaultWebhookFetcher;
  try {
    await fetcher(url, payload);
    structuredLog({
      level: "info",
      event: "EMAIL_FAILURE_WEBHOOK_TEST_SENT",
      scope: scope.kind,
      orgId: scope.kind === "org" ? scope.orgId : undefined,
    });
    return payload;
  } catch (err) {
    structuredLog({
      level: "error",
      event: "EMAIL_FAILURE_WEBHOOK_TEST_FAILED",
      scope: scope.kind,
      orgId: scope.kind === "org" ? scope.orgId : undefined,
      errorCode: redactErrorCode(err),
    });
    throw err;
  }
}

export async function maybeSendFailureWebhook(
  now: number,
  orgScope?: string,
): Promise<void> {
  pruneSamples(now);

  const globalUrl = process.env.EMAIL_FAILURE_WEBHOOK_URL;
  if (globalUrl) {
    const failureCount = samples.length;
    if (
      failureCount >= FAILURE_ALERT_THRESHOLD_PER_HOUR &&
      now - lastWebhookSentAt >= getCooldownMs()
    ) {
      lastWebhookSentAt = now;
      const { topTransport, topErrorCode } = topsForSamples(samples);
      const byOrgBreakdown = buildByOrgBreakdown(samples);
      const [topOrgs, pinnedOrgIds] = await Promise.all([
        topOrgsFromBreakdown(byOrgBreakdown),
        loadPinnedAlertOrgIds(),
      ]);
      const payload = buildPayload(
        failureCount,
        topTransport,
        topErrorCode,
        topOrgs,
        pinnedOrgIds,
      );
      const fetcher = webhookFetcherOverride ?? defaultWebhookFetcher;
      let delivered = false;
      try {
        await fetcher(globalUrl, payload);
        delivered = true;
        logAlertDelivered(payload, { kind: "global" });
      } catch (err) {
        logAlertFailed(err, { kind: "global" });
      }
      trackPendingAlert(
        recordAlert({
          ts: now,
          failureCount,
          threshold: FAILURE_ALERT_THRESHOLD_PER_HOUR,
          thresholdBreached: true,
          topTransport,
          topErrorCode,
          delivered,
          byOrg: byOrgBreakdown,
          alertKind: "transport_failure",
        }),
      );
    }
  }

  if (orgScope) {
    const cfg = orgWebhookConfigs.get(orgScope);
    if (cfg && cfg.url) {
      const scoped = samples.filter((s) => s.orgId === orgScope);
      const failureCount = scoped.length;
      if (failureCount >= FAILURE_ALERT_THRESHOLD_PER_HOUR) {
        const cooldown =
          typeof cfg.cooldownMs === "number" && cfg.cooldownMs >= 0
            ? cfg.cooldownMs
            : getCooldownMs();
        const last = lastOrgWebhookSentAt.get(orgScope) ?? 0;
        if (now - last >= cooldown) {
          lastOrgWebhookSentAt.set(orgScope, now);
          const { topTransport, topErrorCode } = topsForSamples(scoped);
          const payload = buildPayload(failureCount, topTransport, topErrorCode);
          const fetcher = webhookFetcherOverride ?? defaultWebhookFetcher;
          let delivered = false;
          try {
            await fetcher(cfg.url, payload);
            delivered = true;
            logAlertDelivered(payload, { kind: "org", orgId: orgScope });
          } catch (err) {
            logAlertFailed(err, { kind: "org", orgId: orgScope });
          }
          trackPendingAlert(
            recordAlert({
              ts: now,
              failureCount,
              threshold: FAILURE_ALERT_THRESHOLD_PER_HOUR,
              thresholdBreached: true,
              topTransport,
              topErrorCode,
              delivered,
              byOrg: buildByOrgBreakdown(scoped),
              alertKind: "transport_failure",
            }),
          );
        }
      }
    }
  }
}

/**
 * Task #313 — Suppressed-send-spike webhook composer/sender. Mirrors
 * `maybeSendFailureWebhook` for the silenced-send threshold: the
 * global webhook fires when the cross-tenant per-hour count is
 * crossed; a per-org webhook fires when only that org's count is
 * crossed. Both honor independent cooldowns from the transport-failure
 * webhook so a parallel transport-error burst does not silence a
 * concurrent suppression spike (or vice versa).
 *
 * The recorded alert lands in `email_failure_alerts` with
 * `alert_kind = 'suppressed_spike'` so the dashboard's history view
 * surfaces both kinds in one place.
 */
export async function maybeSendSuppressedWebhook(
  now: number,
  orgScope?: string,
): Promise<void> {
  pruneSuppressedSamples(now);
  const threshold = getSuppressedAlertThresholdPerHour();
  const cooldown = getCooldownMs();

  const globalUrl = process.env.EMAIL_FAILURE_WEBHOOK_URL;
  if (globalUrl) {
    const windowCount = suppressedSamples.length;
    if (
      windowCount >= threshold &&
      now - lastSuppressedWebhookSentAtGlobal >= cooldown
    ) {
      lastSuppressedWebhookSentAtGlobal = now;
      const { topTransport } = topsForSuppressedSamples(suppressedSamples);
      const byOrg = buildByOrgBreakdownFromSuppressed(suppressedSamples);
      const payload = buildSuppressedPayload(windowCount, threshold, topTransport);
      const fetcher = webhookFetcherOverride ?? defaultWebhookFetcher;
      let delivered = false;
      try {
        await fetcher(globalUrl, payload);
        delivered = true;
        logSuppressedAlertDelivered(payload, { kind: "global" });
      } catch (err) {
        logSuppressedAlertFailed(err, { kind: "global" });
      }
      trackPendingAlert(
        recordAlert({
          ts: now,
          failureCount: windowCount,
          threshold,
          thresholdBreached: true,
          topTransport,
          topErrorCode: "SUPPRESSED_SEND_SPIKE",
          delivered,
          byOrg,
          alertKind: "suppressed_spike",
        }),
      );
    }
  }

  if (orgScope) {
    const cfg = orgWebhookConfigs.get(orgScope);
    if (cfg && cfg.url) {
      const scoped = suppressedSamples.filter((s) => s.orgId === orgScope);
      const windowCount = scoped.length;
      if (windowCount >= threshold) {
        const orgCooldown =
          typeof cfg.cooldownMs === "number" && cfg.cooldownMs >= 0
            ? cfg.cooldownMs
            : cooldown;
        const last = lastSuppressedWebhookSentAtPerOrg.get(orgScope) ?? 0;
        if (now - last >= orgCooldown) {
          lastSuppressedWebhookSentAtPerOrg.set(orgScope, now);
          const { topTransport } = topsForSuppressedSamples(scoped);
          const byOrg = buildByOrgBreakdownFromSuppressed(scoped);
          const payload = buildSuppressedPayload(
            windowCount,
            threshold,
            topTransport,
          );
          const fetcher = webhookFetcherOverride ?? defaultWebhookFetcher;
          let delivered = false;
          try {
            await fetcher(cfg.url, payload);
            delivered = true;
            logSuppressedAlertDelivered(payload, { kind: "org", orgId: orgScope });
          } catch (err) {
            logSuppressedAlertFailed(err, { kind: "org", orgId: orgScope });
          }
          trackPendingAlert(
            recordAlert({
              ts: now,
              failureCount: windowCount,
              threshold,
              thresholdBreached: true,
              topTransport,
              topErrorCode: "SUPPRESSED_SEND_SPIKE",
              delivered,
              byOrg,
              alertKind: "suppressed_spike",
            }),
          );
        }
      }
    }
  }
}

function topsForSuppressedSamples(
  scoped: SuppressedSendSample[],
): { topTransport: string | null } {
  const transportCounts = new Map<string, number>();
  for (const s of scoped) {
    transportCounts.set(s.transport, (transportCounts.get(s.transport) || 0) + 1);
  }
  return {
    topTransport:
      [...transportCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
}

function buildByOrgBreakdownFromSuppressed(
  source: SuppressedSendSample[],
): Map<string, EmailFailureAlertOrgSlice> {
  const out = new Map<string, EmailFailureAlertOrgSlice>();
  const orgTransportCounts = new Map<string, Map<string, number>>();
  for (const s of source) {
    if (!s.orgId) continue;
    const t = orgTransportCounts.get(s.orgId) ?? new Map<string, number>();
    t.set(s.transport, (t.get(s.transport) || 0) + 1);
    orgTransportCounts.set(s.orgId, t);
    const cur = out.get(s.orgId) ?? {
      failureCount: 0,
      topTransport: null,
      topErrorCode: "SUPPRESSED_SEND_SPIKE" as string | null,
    };
    cur.failureCount += 1;
    out.set(s.orgId, cur);
  }
  for (const [orgId, agg] of out) {
    agg.topTransport =
      [...(orgTransportCounts.get(orgId) ?? new Map<string, number>()).entries()].sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0] ?? null;
  }
  return out;
}

function buildSuppressedPayload(
  windowCount: number,
  threshold: number,
  topTransport: string | null,
): FailureWebhookPayload {
  const text =
    `:no_bell: Silenced-send spike: ${windowCount} send` +
    `${windowCount === 1 ? "" : "s"} short-circuited by the suppression list ` +
    `in the last hour (threshold ${threshold}). ` +
    `This usually means a bulk-suppress went too wide. ` +
    `Top transport: ${topTransport ?? "unknown"}. ` +
    `Review the Suppressed tab on the email-health page to triage.`;
  return {
    text,
    failureCount: windowCount,
    windowMs: ROLLING_WINDOW_MS,
    threshold,
    topTransport,
    topErrorCode: "SUPPRESSED_SEND_SPIKE",
    alertKind: "suppressed_spike",
    suppressionsUrl: "/admin/email-health?tab=suppressed",
  };
}

function logSuppressedAlertDelivered(
  payload: FailureWebhookPayload,
  scope: { kind: "global" } | { kind: "org"; orgId: string },
): void {
  structuredLog({
    level: "info",
    event: "EMAIL_SUPPRESSED_WEBHOOK_SENT",
    scope: scope.kind,
    orgId: scope.kind === "org" ? scope.orgId : undefined,
    windowCount: payload.failureCount,
    topTransport: payload.topTransport,
  });
}

function logSuppressedAlertFailed(
  err: unknown,
  scope: { kind: "global" } | { kind: "org"; orgId: string },
): void {
  structuredLog({
    level: "error",
    event: "EMAIL_SUPPRESSED_WEBHOOK_FAILED",
    scope: scope.kind,
    orgId: scope.kind === "org" ? scope.orgId : undefined,
    errorCode: redactErrorCode(err),
  });
}

/**
 * Wrap an EmailTransport so any thrown error is recorded via
 * recordEmailFailure (which also emits an EMAIL_TRANSPORT_ERROR
 * structured log line) before being re-thrown unchanged.
 *
 * For ok:false results (e.g. SMTP-not-configured noop), the recorded
 * transport name is taken from `result.transport` (which is "noop"),
 * not from `transport.kind`, so triage sees the actual outcome.
 */
export function wrapTransportWithFailureTracking(
  transport: EmailTransport,
  orgId: string | undefined,
): EmailTransport {
  return {
    kind: transport.kind,
    async send(message: SendableMessage): Promise<SendResult> {
      try {
        const result = await transport.send(message);
        if (result.ok === false) {
          recordEmailFailure(
            orgId,
            result.transport,
            new EmailTransportError(
              result.transport,
              `noop:${result.messageId}`,
            ),
            message.to,
          );
        }
        return result;
      } catch (err) {
        recordEmailFailure(orgId, transport.kind, err, message.to);
        throw err;
      }
    },
  };
}

/**
 * Map a pre-send / selection error to the transport name we should tag
 * the failure with. Used by callers that wrap `selectTransport(...)` so
 * MissingMailboxError ("m365"/"google") and other selection-time errors
 * still emit EMAIL_TRANSPORT_ERROR with the right transport label.
 */
export function transportLabelFromSelectionError(err: unknown): string {
  if (err instanceof MissingMailboxError) {
    return err.providerType === "m365" ? "graph" : "gmail";
  }
  if (err instanceof EmailTransportError) return err.transport || "unknown";
  return "unknown";
}

/**
 * Run the transport selection step under failure tracking. Any thrown
 * error is recorded then re-thrown unchanged so the caller's existing
 * error semantics are preserved. The returned transport is itself
 * wrapped via wrapTransportWithFailureTracking so subsequent send
 * failures are captured too.
 */
export async function trackSelection(
  orgId: string | undefined,
  select: () => Promise<EmailTransport>,
): Promise<EmailTransport> {
  let transport: EmailTransport;
  try {
    transport = await select();
  } catch (err) {
    recordEmailFailure(orgId, transportLabelFromSelectionError(err), err);
    throw err;
  }
  return wrapTransportWithFailureTracking(transport, orgId);
}
