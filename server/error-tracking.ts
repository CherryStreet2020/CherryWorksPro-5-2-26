import { randomUUID } from "crypto";

interface Breadcrumb {
  timestamp: string;
  category: string;
  message: string;
  level: "debug" | "info" | "warning" | "error" | "fatal";
  data?: Record<string, any>;
}

interface ErrorEvent {
  id: string;
  timestamp: string;
  level: "error" | "warning" | "fatal";
  message: string;
  stack?: string;
  requestId?: string;
  userId?: string;
  orgId?: string;
  url?: string;
  method?: string;
  breadcrumbs: Breadcrumb[];
  tags: Record<string, string>;
  extra: Record<string, any>;
  release?: string;
  environment: string;
  fingerprint?: string;
}

const SENSITIVE_FIELDS = new Set([
  "password", "token", "secret", "apiKey", "api_key", "authorization",
  "cookie", "ssn", "bankAccountNumber", "bankRoutingNumber", "creditCard",
  "cardNumber", "cvv", "ein", "socialSecurity",
]);

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;

function scrubPII(obj: any, depth = 0): any {
  if (depth > 5) return "[MAX_DEPTH]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    return obj
      .replace(EMAIL_REGEX, "[EMAIL_REDACTED]")
      .replace(PHONE_REGEX, "[PHONE_REDACTED]")
      .replace(SSN_REGEX, "[SSN_REDACTED]");
  }
  if (Array.isArray(obj)) return obj.map(item => scrubPII(item, depth + 1));
  if (typeof obj === "object") {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_FIELDS.has(key.toLowerCase())) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = scrubPII(value, depth + 1);
      }
    }
    return result;
  }
  return obj;
}

const errorEvents: ErrorEvent[] = [];
const MAX_EVENTS = 1000;

const breadcrumbBuffer: Map<string, Breadcrumb[]> = new Map();
const MAX_BREADCRUMBS = 50;

export const RELEASE = process.env.APP_RELEASE || `cwp-${new Date().toISOString().split("T")[0]}`;
export const ENVIRONMENT = process.env.NODE_ENV || "development";

export function addBreadcrumb(requestId: string, crumb: Omit<Breadcrumb, "timestamp">) {
  if (!breadcrumbBuffer.has(requestId)) breadcrumbBuffer.set(requestId, []);
  const crumbs = breadcrumbBuffer.get(requestId)!;
  crumbs.push({ ...crumb, timestamp: new Date().toISOString() });
  if (crumbs.length > MAX_BREADCRUMBS) crumbs.shift();
}

export function captureError(error: Error | string, context: {
  requestId?: string;
  userId?: string;
  orgId?: string;
  url?: string;
  method?: string;
  tags?: Record<string, string>;
  extra?: Record<string, any>;
  level?: "error" | "warning" | "fatal";
}): string {
  const eventId = randomUUID();
  const message = typeof error === "string" ? error : error.message;
  const stack = typeof error === "string" ? undefined : error.stack;

  const breadcrumbs = context.requestId
    ? (breadcrumbBuffer.get(context.requestId) || [])
    : [];

  const event: ErrorEvent = {
    id: eventId,
    timestamp: new Date().toISOString(),
    level: context.level || "error",
    message: scrubPII(message) as string,
    stack: stack ? (scrubPII(stack) as string) : undefined,
    requestId: context.requestId,
    userId: context.userId ? "[USER_ID]" : undefined,
    orgId: context.orgId ? "[ORG_ID]" : undefined,
    url: context.url,
    method: context.method,
    breadcrumbs: scrubPII(breadcrumbs),
    tags: { ...context.tags, environment: ENVIRONMENT, release: RELEASE },
    extra: scrubPII(context.extra || {}),
    release: RELEASE,
    environment: ENVIRONMENT,
    fingerprint: `${message.substring(0, 100)}-${context.url || "unknown"}`,
  };

  errorEvents.push(event);
  if (errorEvents.length > MAX_EVENTS) errorEvents.shift();

  if (context.requestId) breadcrumbBuffer.delete(context.requestId);

  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: event.level,
    event_id: eventId,
    message: event.message,
    url: event.url,
    release: RELEASE,
    environment: ENVIRONMENT,
  }));

  return eventId;
}

export function getErrorEvents(filters?: {
  level?: string;
  limit?: number;
  offset?: number;
  environment?: string;
}): { events: ErrorEvent[]; total: number } {
  let filtered = errorEvents.slice().reverse();
  if (filters?.level) filtered = filtered.filter(e => e.level === filters.level);
  if (filters?.environment) filtered = filtered.filter(e => e.environment === filters.environment);
  const total = filtered.length;
  const limit = filters?.limit || 50;
  const offset = filters?.offset || 0;
  return { events: filtered.slice(offset, offset + limit), total };
}

export function getErrorEvent(id: string): ErrorEvent | undefined {
  return errorEvents.find(e => e.id === id);
}

export function clearOldEvents(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - olderThanMs;
  const before = errorEvents.length;
  const remaining = errorEvents.filter(e => new Date(e.timestamp).getTime() > cutoff);
  errorEvents.length = 0;
  errorEvents.push(...remaining);
  return before - errorEvents.length;
}

export function getStats(): { total: number; byLevel: Record<string, number>; release: string; environment: string } {
  const byLevel: Record<string, number> = {};
  for (const e of errorEvents) {
    byLevel[e.level] = (byLevel[e.level] || 0) + 1;
  }
  return { total: errorEvents.length, byLevel, release: RELEASE, environment: ENVIRONMENT };
}
