import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSecret(): string {
  return process.env.SESSION_SECRET || "dev-only-fallback-state-secret-do-not-use-in-prod";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export interface OauthStatePayload {
  orgId: string;
  userId: string;
  provider: "m365" | "google";
  nonce: string;
  ts: number;
}

/**
 * Sign an OAuth `state` parameter. Format: base64url(payload).base64url(hmacSha256).
 * The signed payload includes the org/user/provider so the callback can route
 * correctly and refuse mismatched sessions (CSRF guard, test case I8).
 */
export function signOauthState(input: Omit<OauthStatePayload, "nonce" | "ts">): string {
  const payload: OauthStatePayload = {
    ...input,
    nonce: randomBytes(12).toString("hex"),
    ts: Date.now(),
  };
  const json = JSON.stringify(payload);
  const payloadB64 = b64url(Buffer.from(json, "utf8"));
  const sig = createHmac("sha256", getSecret()).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

export function verifyOauthState(state: string): OauthStatePayload | null {
  if (typeof state !== "string" || !state.includes(".")) return null;
  const [payloadB64, sigB64] = state.split(".");
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = createHmac("sha256", getSecret()).update(payloadB64).digest();
  let givenSig: Buffer;
  try {
    givenSig = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (givenSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(givenSig, expectedSig)) return null;

  let payload: OauthStatePayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.ts !== "number" || Date.now() - payload.ts > STATE_TTL_MS) return null;
  if (payload.provider !== "m365" && payload.provider !== "google") return null;
  if (!payload.orgId || !payload.userId) return null;
  return payload;
}
