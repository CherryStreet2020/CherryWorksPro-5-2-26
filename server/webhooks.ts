import { db, pool } from "./db";
import { webhookEndpoints, webhookDeliveries, auditLogs, type WebhookEventType } from "@shared/schema";
import { eq, and, lte, lt, sql } from "drizzle-orm";
import { createHmac, randomUUID } from "crypto";
import { decryptField } from "./storage";

const MAX_WEBHOOK_RESPONSE_BODY_LENGTH = 2000;
const DNS_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA", "EAI_NONAME"]);
const DNS_CONSECUTIVE_FAILURE_THRESHOLD = 3;
const DNS_RETRY_DELAYS_MS = [60_000, 300_000, 900_000];

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\.0\.0\.0/,
  /^169\.254\./,
  /^::1$/,
  /^0*:0*:0*:0*:0*:0*:0*:0*1$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^::ffff:(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/i,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000];

function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      hostname = hostname.slice(1, -1);
    }
    if (hostname === "localhost") return true;
    if (hostname === "metadata.google.internal") return true;
    if (PRIVATE_IP_PATTERNS.some(p => p.test(hostname))) return true;
    if (parsed.protocol !== "https:") return true;
    return false;
  } catch {
    return true;
  }
}

function computeNextRetryAt(attemptNumber: number, isDns = false): Date | null {
  const delays = isDns ? DNS_RETRY_DELAYS_MS : RETRY_DELAYS_MS;
  const delayIndex = attemptNumber - 1;
  if (delayIndex >= delays.length) return null;
  return new Date(Date.now() + delays[delayIndex]);
}

function isDnsError(err: any): boolean {
  const code = err?.cause?.code || err?.code || "";
  return DNS_ERROR_CODES.has(code);
}

function classifyErrorType(err: any): string {
  if (isDnsError(err)) return "dns";
  if (err?.name === "AbortError" || err?.type === "aborted") return "timeout";
  return "connection";
}

const WEBHOOK_SECRET_GRACE_PERIOD_MS = 60_000;

async function deliverWebhook(
  endpointUrl: string,
  endpointSecret: string,
  endpointId: string,
  deliveryId: string,
  payloadStr: string,
  event: string,
  attemptNumber: number,
  maxAttempts: number,
  oldSecret?: string | null,
  secretRotatedAt?: Date | null,
): Promise<void> {
  const decryptedSecret = decryptField(endpointSecret);
  let signature = createHmac("sha256", decryptedSecret).update(payloadStr).digest("hex");

  if (oldSecret && secretRotatedAt) {
    const gracePeriodActive = Date.now() - secretRotatedAt.getTime() < WEBHOOK_SECRET_GRACE_PERIOD_MS;
    if (gracePeriodActive) {
      const oldDecrypted = decryptField(oldSecret);
      const oldSig = createHmac("sha256", oldDecrypted).update(payloadStr).digest("hex");
      signature = `${signature},${oldSig}`;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-256": `sha256=${signature}`,
        "X-CWP-Event": event,
        "X-CWP-Delivery-Id": deliveryId,
      },
      body: payloadStr,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const responseBody = await response.text().catch(() => "");
    const contentLength = response.headers.get("content-length");
    const status = response.ok ? "delivered" : "failed";
    const truncated = responseBody.length > MAX_WEBHOOK_RESPONSE_BODY_LENGTH;
    const storedBody = truncated
      ? responseBody.substring(0, MAX_WEBHOOK_RESPONSE_BODY_LENGTH) + `\n[truncated — full Content-Length: ${contentLength || responseBody.length}]`
      : responseBody;

    const updateData: any = {
      statusCode: response.status,
      responseBody: storedBody,
      deliveredAt: new Date(),
      attempts: attemptNumber,
      status: status as any,
      lastErrorType: status === "failed" ? "http" : null,
    };

    if (status === "failed") {
      const nextRetry = computeNextRetryAt(attemptNumber);
      if (nextRetry && attemptNumber < maxAttempts) {
        updateData.nextRetryAt = nextRetry;
      } else {
        updateData.nextRetryAt = null;
        updateData.lastErrorType = "dead_letter";
      }
    } else {
      updateData.nextRetryAt = null;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(webhookDeliveries)
        .set(updateData)
        .where(eq(webhookDeliveries.id, deliveryId));

      const endpointUpdate: any = { lastDeliveryAt: new Date(), lastDeliveryStatus: status, dnsConsecutiveFailures: 0 };

      await tx
        .update(webhookEndpoints)
        .set(endpointUpdate)
        .where(eq(webhookEndpoints.id, endpointId));
    });
  } catch (fetchErr: any) {
    const errorType = classifyErrorType(fetchErr);
    const dnsFailure = errorType === "dns";
    const nextRetry = computeNextRetryAt(attemptNumber, dnsFailure);
    const updateData: any = {
      status: "failed" as any,
      attempts: attemptNumber,
      responseBody: (fetchErr.message || "Connection failed").substring(0, MAX_WEBHOOK_RESPONSE_BODY_LENGTH),
      lastErrorType: errorType,
    };

    if (nextRetry && attemptNumber < maxAttempts) {
      updateData.nextRetryAt = nextRetry;
    } else {
      updateData.nextRetryAt = null;
      updateData.lastErrorType = "dead_letter";
    }

    await db
      .update(webhookDeliveries)
      .set(updateData)
      .where(eq(webhookDeliveries.id, deliveryId));

    const endpointUpdate: any = { lastDeliveryAt: new Date(), lastDeliveryStatus: "failed" as any };

    if (dnsFailure) {
      const [ep] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, endpointId));
      const newDnsFailures = (ep?.dnsConsecutiveFailures ?? 0) + 1;
      endpointUpdate.dnsConsecutiveFailures = newDnsFailures;

      if (newDnsFailures >= DNS_CONSECUTIVE_FAILURE_THRESHOLD) {
        endpointUpdate.isActive = false;
        console.warn(`[webhooks] Auto-disabled endpoint ${endpointId} after ${newDnsFailures} consecutive DNS failures`);

        if (ep?.orgId) {
          try {
            await db.insert(auditLogs).values({
              orgId: ep.orgId,
              userId: "system",
              action: "WEBHOOK_AUTO_DISABLED",
              entityType: "webhook_endpoint",
              entityId: endpointId,
              details: { reason: "dns_unreachable", consecutiveFailures: newDnsFailures, lastError: fetchErr.message?.substring(0, 200) },
            });
          } catch {}
        }

        await db
          .update(webhookDeliveries)
          .set({ nextRetryAt: null })
          .where(eq(webhookDeliveries.id, deliveryId));
      }
    } else {
      endpointUpdate.dnsConsecutiveFailures = 0;
    }

    await db
      .update(webhookEndpoints)
      .set(endpointUpdate)
      .where(eq(webhookEndpoints.id, endpointId));
  }
}

export function fireWebhookEvent(orgId: string, event: WebhookEventType, payload: any) {
  setImmediate(async () => {
    try {
      const endpoints = await db
        .select()
        .from(webhookEndpoints)
        .where(and(eq(webhookEndpoints.orgId, orgId), eq(webhookEndpoints.isActive, true)));

      const matching = endpoints.filter((ep) => {
        const events = (Array.isArray(ep.events) ? ep.events : []) as string[];
        return events.includes(event) || events.includes("*");
      });

      for (const ep of matching) {
        if (isPrivateUrl(ep.url)) {
          console.warn(`[webhook] Blocked delivery to private/internal URL for endpoint ${ep.id}`);
          continue;
        }

        const idempotencyKey = randomUUID();
        const fullPayload = { event, data: payload, timestamp: new Date().toISOString(), idempotencyKey };
        const payloadStr = JSON.stringify(fullPayload);

        const [delivery] = await db
          .insert(webhookDeliveries)
          .values({
            orgId,
            webhookEndpointId: ep.id,
            event,
            payload: fullPayload,
            attempts: 1,
            maxAttempts: 6,
            status: "pending",
            idempotencyKey,
          })
          .returning();

        await deliverWebhook(ep.url, ep.secret, ep.id, delivery.id, payloadStr, event, 1, 6, ep.oldSecret, ep.secretRotatedAt);
      }
    } catch (err) {
      console.error(`[webhooks] Error firing ${event} for org ${orgId}:`, err);
    }
  });
}

async function processRetries(): Promise<void> {
  const lockResult = await pool.query("SELECT pg_try_advisory_lock(100001) AS acquired");
  if (!lockResult.rows[0]?.acquired) return;
  try {
    const pendingRetries = await db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.status, "failed"),
          lte(webhookDeliveries.nextRetryAt, new Date()),
          lt(webhookDeliveries.attempts, webhookDeliveries.maxAttempts),
        ),
      )
      .limit(10);

    for (const delivery of pendingRetries) {
      const [endpoint] = await db
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.id, delivery.webhookEndpointId));

      if (!endpoint || !endpoint.isActive) {
        await db
          .update(webhookDeliveries)
          .set({ nextRetryAt: null })
          .where(eq(webhookDeliveries.id, delivery.id));
        continue;
      }

      if (isPrivateUrl(endpoint.url)) {
        await db
          .update(webhookDeliveries)
          .set({ nextRetryAt: null })
          .where(eq(webhookDeliveries.id, delivery.id));
        continue;
      }

      const payloadStr = JSON.stringify(delivery.payload);
      const nextAttempt = delivery.attempts + 1;

      await deliverWebhook(
        endpoint.url,
        endpoint.secret,
        endpoint.id,
        delivery.id,
        payloadStr,
        delivery.event,
        nextAttempt,
        delivery.maxAttempts,
        endpoint.oldSecret,
        endpoint.secretRotatedAt,
      );
    }

    const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const staleResult = await db
      .update(webhookDeliveries)
      .set({
        status: "failed" as any,
        responseBody: "Delivery timed out — stuck in pending for over 24 hours",
        lastErrorType: "timeout",
        nextRetryAt: null,
      })
      .where(
        and(
          eq(webhookDeliveries.status, "pending"),
          lte(webhookDeliveries.createdAt, staleThreshold),
        ),
      )
      .returning({ id: webhookDeliveries.id });

    if (staleResult.length > 0) {
      console.warn(`[webhooks] Marked ${staleResult.length} stale pending deliveries as failed`);
    }
  } catch (err) {
    console.error("[webhooks] Error processing retries:", err);
  } finally {
    await pool.query("SELECT pg_advisory_unlock(100001)").catch(() => {});
  }
}

let retryInterval: ReturnType<typeof setInterval> | null = null;

export function startWebhookRetryProcessor(): void {
  if (retryInterval) return;
  retryInterval = setInterval(processRetries, 30_000);
  console.log("[webhooks] Retry processor started (30s interval)");
}

export function stopWebhookRetryProcessor(): void {
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
}
