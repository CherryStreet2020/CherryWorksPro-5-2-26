/**
 * Azure Communication Services Email, for marketing sends only (see
 * `marketing-route.ts` for who gets routed here). Everything ACS-specific lives
 * in this file: the REST contract, the token cache, the outcome tables and the
 * send/poll gates. The worker turns the typed outcomes into attempt rows.
 *
 * ACS is asynchronous: POST /emails:send returns 202 + an operation that later
 * becomes Succeeded / Failed / Canceled. The worker writes the attempt row
 * BEFORE the POST and uses its id as the Operation-Id, so a message whose fate
 * is unknown is polled, never POSTed again.
 *
 * Tokens: `DefaultAzureCredential` (the app's managed identity) is never awaited
 * on a send or poll path, because the SDK cannot abort a managed-identity
 * acquisition. A single-flight refresher on its own timer keeps the cache warm;
 * sends and polls only read the cache.
 */
import { DefaultAzureCredential, type AccessToken, type TokenCredential } from "@azure/identity";
import { assertSafeHeaders, type SendableMessage } from "./types";

export const ACS_API_VERSION = "2025-09-01";
const ACS_SCOPE = "https://communication.azure.com/.default";

const POST_DEADLINE_MS = 15_000;
const GET_DEADLINE_MS = 5_000;
/** The send path only uses a token with at least this much life left. */
const TOKEN_USABLE_MARGIN_MS = 5 * 60_000;
/** The refresher starts a new acquisition once less than this is left. */
const TOKEN_REFRESH_MARGIN_MS = 10 * 60_000;
const TOKEN_REFRESH_TICK_MS = 60_000;
/** An acquisition outstanding longer than this raises the degraded alert. */
const TOKEN_STALL_MS = 30_000;

/** Pause after each ACS send: ~28/min, under the 30/min default quota. */
export const ACS_SEND_INTERVAL_MS = 2_100;
/** Pause between operation GETs: ~55/min, under the 60/min status cap. */
export const ACS_POLL_INTERVAL_MS = 1_100;
/** GETs per sliding hour, under the 200/h status cap. */
export const ACS_POLL_BUDGET_PER_HOUR = 180;
const HOUR_MS = 60 * 60_000;
const DEFAULT_POLL_COOLDOWN_MS = 60_000;
const DEFAULT_SEND_COOLDOWN_MS = 60_000;
const DEFAULT_ACCEPTED_RETRY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  const override = (global as any).__emailTestSleep as ((ms: number) => Promise<void>) | undefined;
  if (override) return override(ms);
  return new Promise((r) => setTimeout(r, ms));
}

// ── Endpoint ────────────────────────────────────────────────────────────────

/** The base URL requests go to. `ACS_EMAIL_TEST_URL_OVERRIDE` replaces only this, not the token path. */
function baseUrl(endpoint: string): string {
  const override = process.env.ACS_EMAIL_TEST_URL_OVERRIDE;
  return (override || endpoint).replace(/\/+$/, "");
}

// ── Token cache + refresher ──────────────────────────────────────────────────

let credential: TokenCredential | null = null;
let cachedToken: AccessToken | null = null;
let inflight: Promise<void> | null = null;
let inflightStartedAt = 0;
let stallReported = false;
let refresherTimer: NodeJS.Timeout | null = null;
let onDegraded: ((code: string) => void) | null = null;

function getCredential(): TokenCredential {
  if (!credential) credential = new DefaultAzureCredential();
  return credential;
}

/** The cached token if it has enough life left, else null. Never waits. */
export function getCachedAcsToken(now: number = Date.now()): string | null {
  if (!cachedToken) return null;
  if (cachedToken.expiresOnTimestamp - now < TOKEN_USABLE_MARGIN_MS) return null;
  return cachedToken.token;
}

/**
 * Starts an acquisition unless one is outstanding or the cache is fresh. A
 * stalled acquisition is left to the event loop; it only writes the cache when
 * it settles. Resolves when the acquisition it started (or found) settles.
 */
export function refreshAcsTokenIfNeeded(opts: { force?: boolean; now?: number } = {}): Promise<void> {
  const now = opts.now ?? Date.now();
  if (inflight) {
    if (!stallReported && now - inflightStartedAt > TOKEN_STALL_MS) {
      stallReported = true;
      console.error("[acs] token acquisition outstanding > 30s");
      onDegraded?.("ACS_AUTH");
    }
    return inflight;
  }
  if (!opts.force && cachedToken && cachedToken.expiresOnTimestamp - now >= TOKEN_REFRESH_MARGIN_MS) {
    return Promise.resolve();
  }
  inflightStartedAt = now;
  stallReported = false;
  inflight = (async () => {
    try {
      const token = await getCredential().getToken(ACS_SCOPE);
      if (token) cachedToken = token;
      else console.error("[acs] token acquisition returned no token");
    } catch (err) {
      console.error("[acs] token acquisition failed:", err instanceof Error ? err.name : "unknown");
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Keeps the token cache warm on its own timer, outside the worker's advisory
 * lock. Idempotent. `degraded` is told when an acquisition stalls.
 */
export function startAcsTokenRefresher(degraded?: (code: string) => void): void {
  if (degraded) onDegraded = degraded;
  if (refresherTimer) return;
  void refreshAcsTokenIfNeeded();
  refresherTimer = setInterval(() => void refreshAcsTokenIfNeeded(), TOKEN_REFRESH_TICK_MS);
  refresherTimer.unref?.();
}

export function stopAcsTokenRefresher(): void {
  if (refresherTimer) clearInterval(refresherTimer);
  refresherTimer = null;
}

/** For tests: swap the credential and clear the cache and any outstanding acquisition. */
export function setAcsCredentialForTests(next: TokenCredential | null): void {
  credential = next;
  cachedToken = null;
  inflight = null;
  inflightStartedAt = 0;
  stallReported = false;
}

// ── Send cooldown + poll gate (per process; cwp-app runs one replica) ──────

let acsCooldownUntil = 0;
let acsPollCooldownUntil = 0;
let lastPollAt = 0;
const pollTimes: number[] = [];

export function acsCooldownActive(now: number = Date.now()): boolean {
  return now < acsCooldownUntil;
}

export function acsCooldownUntilMs(): number {
  return acsCooldownUntil;
}

/** Extends the send cooldown; never shortens it. */
export function extendAcsCooldown(untilMs: number): void {
  if (untilMs > acsCooldownUntil) acsCooldownUntil = untilMs;
}

export function extendAcsPollCooldown(untilMs: number): void {
  if (untilMs > acsPollCooldownUntil) acsPollCooldownUntil = untilMs;
}

function prunePollWindow(now: number): void {
  while (pollTimes.length && now - pollTimes[0] >= HOUR_MS) pollTimes.shift();
}

/**
 * Every operation GET goes through here. False (and no wait) while the poll
 * cooldown is active, when the hourly budget is spent, or when pacing would
 * run past `deadline`. Otherwise waits out the pacing interval, counts the GET
 * and returns true.
 */
/**
 * Whether a poll slot could be granted at `at` (≥ now) and its GET still end
 * by `deadline`, as far as can be known now: lets a caller skip a wait that
 * cannot end in a GET.
 */
export function acsPollSlotFeasible(at: number, deadline: number): boolean {
  if (at < acsPollCooldownUntil) return false;
  prunePollWindow(Date.now());
  if (pollTimes.length >= ACS_POLL_BUDGET_PER_HOUR) return false;
  const slotAt = Math.max(at, lastPollAt + ACS_POLL_INTERVAL_MS);
  return slotAt + GET_DEADLINE_MS <= deadline;
}

export async function acquireAcsPollSlot(deadline: number): Promise<boolean> {
  const now = Date.now();
  if (now < acsPollCooldownUntil) return false;
  prunePollWindow(now);
  if (pollTimes.length >= ACS_POLL_BUDGET_PER_HOUR) return false;
  const wait = Math.max(0, lastPollAt + ACS_POLL_INTERVAL_MS - now);
  if (now + wait + GET_DEADLINE_MS > deadline) return false;
  await sleep(wait);
  const at = Math.max(Date.now(), lastPollAt + ACS_POLL_INTERVAL_MS);
  lastPollAt = at;
  pollTimes.push(at);
  return true;
}

export function resetAcsStateForTests(): void {
  acsCooldownUntil = 0;
  acsPollCooldownUntil = 0;
  lastPollAt = 0;
  pollTimes.length = 0;
  onDegraded = null;
  stopAcsTokenRefresher();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** `Retry-After` in ms (seconds or HTTP-date), else `fallback`. */
export function parseRetryAfterMs(value: string | null, fallback: number, now: number = Date.now()): number {
  if (!value) return fallback;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.max(0, at - now);
  return fallback;
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function errorCodeOf(body: any): string | null {
  const code = body?.error?.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/** Provider codes go into our error column; keep them short and free of anything but [A-Za-z0-9_.]. */
function sanitizeCode(code: string): string {
  return code.replace(/[^A-Za-z0-9_.]/g, "").slice(0, 64) || "UNKNOWN";
}

export type AcsFailureClass = "recipient" | "quota" | "unknown";

/**
 * Class of an operation-level `Failed` error code. Recipient-level codes are
 * permanent for that address; quota codes mean the message was not sent and
 * can go again after the cooldown; anything else is an ordinary transient.
 */
export function classifyAcsFailureCode(code: string | null | undefined): AcsFailureClass {
  if (!code) return "unknown";
  if (/quota|throttl|toomanyrequests|ratelimit|limitexceeded/i.test(code)) return "quota";
  if (/recipient|suppress|blocked|invalidemail|invalidaddress|mailbox|bounce|undeliverable/i.test(code)) {
    return "recipient";
  }
  return "unknown";
}

// ── POST /emails:send ───────────────────────────────────────────────────────

export type AcsSendOutcome =
  /** 202. `retryAfterMs` = the operation's suggested first poll delay. */
  | { kind: "accepted"; retryAfterMs: number }
  /** Definitively not taken for provider reasons; does not consume an attempt. */
  | { kind: "deferred"; code: "ACS_AUTH" | "ACS_THROTTLED"; retryAfterMs: number }
  /** 400/404: the request (sender, recipient, body) was rejected. */
  | { kind: "rejected"; code: "ACS_REJECTED"; providerCode: string | null }
  /** 5xx, timeout, connection lost: may have been taken. Poll it, never POST it again. */
  | { kind: "ambiguous"; code: "ACS_POST_AMBIGUOUS" };

export interface AcsSendInput {
  endpoint: string;
  operationId: string;
  senderAddress: string;
  message: SendableMessage;
}

export function buildAcsSendBody(senderAddress: string, msg: SendableMessage): Record<string, unknown> {
  assertSafeHeaders("acs", msg.headers);
  const body: Record<string, unknown> = {
    senderAddress,
    content: {
      subject: msg.subject,
      html: msg.html,
      ...(msg.text ? { plainText: msg.text } : {}),
    },
    recipients: { to: [{ address: msg.to }] },
    userEngagementTrackingDisabled: true,
  };
  if (msg.replyTo) body.replyTo = [{ address: msg.replyTo }];
  if (msg.headers && Object.keys(msg.headers).length > 0) body.headers = { ...msg.headers };
  return body;
}

/**
 * One POST. Never waits for a token: no usable cached token ⇒ `deferred ACS_AUTH`
 * with nothing sent. A 401/403 also asks the refresher for a new token (not
 * awaited); the retry happens on a later tick with the refreshed token.
 */
export async function acsSend(input: AcsSendInput): Promise<AcsSendOutcome> {
  const body = buildAcsSendBody(input.senderAddress, input.message);
  const token = getCachedAcsToken();
  if (!token) {
    void refreshAcsTokenIfNeeded();
    return { kind: "deferred", code: "ACS_AUTH", retryAfterMs: DEFAULT_SEND_COOLDOWN_MS };
  }
  const url = `${baseUrl(input.endpoint)}/emails:send?api-version=${ACS_API_VERSION}`;
  let res: Response;
  let json: any;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Operation-Id": input.operationId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POST_DEADLINE_MS),
    });
    json = await readJson(res);
  } catch {
    return { kind: "ambiguous", code: "ACS_POST_AMBIGUOUS" };
  }
  const retryAfter = res.headers.get("retry-after");
  if (res.status === 202) {
    return { kind: "accepted", retryAfterMs: parseRetryAfterMs(retryAfter, DEFAULT_ACCEPTED_RETRY_MS) };
  }
  if (res.status === 401 || res.status === 403) {
    void refreshAcsTokenIfNeeded({ force: true });
    return { kind: "deferred", code: "ACS_AUTH", retryAfterMs: DEFAULT_SEND_COOLDOWN_MS };
  }
  if (res.status === 429) {
    return {
      kind: "deferred",
      code: "ACS_THROTTLED",
      retryAfterMs: parseRetryAfterMs(retryAfter, DEFAULT_SEND_COOLDOWN_MS),
    };
  }
  if (res.status === 400 || res.status === 404) {
    const code = errorCodeOf(json);
    return { kind: "rejected", code: "ACS_REJECTED", providerCode: code ? sanitizeCode(code) : null };
  }
  return { kind: "ambiguous", code: "ACS_POST_AMBIGUOUS" };
}

// ── GET /emails/operations/{id} ─────────────────────────────────────────────

export type AcsOperationOutcome =
  | { kind: "succeeded" }
  /** Failed with a recipient-level code. */
  | { kind: "permanent"; code: string }
  /** Failed with a quota/throttle code: not sent, safe to send again after the cooldown. */
  | { kind: "throttled"; code: string }
  /** Failed with an unknown code, or Canceled: ordinary transient. */
  | { kind: "failed"; code: string }
  /** NotStarted / Running. */
  | { kind: "pending"; retryAfterMs: number | null }
  /** 404: the operation isn't known (yet). */
  | { kind: "not_found" }
  /** GET 429: the poll cooldown has been set. */
  | { kind: "poll_throttled"; retryAfterMs: number }
  /** 401/403/5xx/timeout/no token: try again after the poll backoff. */
  | { kind: "error" };

/** One GET. The caller must have taken a slot from `acquireAcsPollSlot`. */
export async function acsGetOperation(endpoint: string, operationId: string): Promise<AcsOperationOutcome> {
  const token = getCachedAcsToken();
  if (!token) {
    void refreshAcsTokenIfNeeded();
    return { kind: "error" };
  }
  const url =
    `${baseUrl(endpoint)}/emails/operations/${encodeURIComponent(operationId)}` +
    `?api-version=${ACS_API_VERSION}`;
  let res: Response;
  let json: any;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(GET_DEADLINE_MS),
    });
    json = await readJson(res);
  } catch {
    return { kind: "error" };
  }
  const retryAfter = res.headers.get("retry-after");
  if (res.status === 429) {
    const retryAfterMs = parseRetryAfterMs(retryAfter, DEFAULT_POLL_COOLDOWN_MS);
    extendAcsPollCooldown(Date.now() + retryAfterMs);
    return { kind: "poll_throttled", retryAfterMs };
  }
  if (res.status === 404) return { kind: "not_found" };
  if (res.status === 401 || res.status === 403) {
    void refreshAcsTokenIfNeeded({ force: true });
    return { kind: "error" };
  }
  if (res.status !== 200) return { kind: "error" };
  const status = typeof json?.status === "string" ? json.status : "";
  switch (status) {
    case "Succeeded":
      return { kind: "succeeded" };
    case "NotStarted":
    case "Running":
      return { kind: "pending", retryAfterMs: retryAfter ? parseRetryAfterMs(retryAfter, 0) : null };
    case "Canceled":
      return { kind: "failed", code: "ACS_CANCELED" };
    case "Failed": {
      const raw = errorCodeOf(json);
      const cls = classifyAcsFailureCode(raw);
      const code = raw ? `ACS_${sanitizeCode(raw)}`.slice(0, 64) : "ACS_FAILED";
      if (cls === "recipient") return { kind: "permanent", code };
      if (cls === "quota") return { kind: "throttled", code: "ACS_THROTTLED" };
      return { kind: "failed", code };
    }
    default:
      return { kind: "error" };
  }
}

/**
 * Wait before the next GET, by how many GETs the row has had including the one
 * just made: 1 m after the first, 5 m after the second, 15 m after the third,
 * then hourly.
 */
export function acsPollBackoffMs(pollCount: number): number {
  if (pollCount <= 1) return 60_000;
  if (pollCount === 2) return 5 * 60_000;
  if (pollCount === 3) return 15 * 60_000;
  return HOUR_MS;
}

/** An `accepted` row older than this is ended as `ACS_OPERATION_UNRESOLVED`. */
export const ACS_UNRESOLVED_AFTER_MS = 24 * HOUR_MS;
