/**
 * Platform-wide runtime switches (platform_settings table).
 *
 * signup_enabled: public signup on/off without a deploy. The environment
 * variable SIGNUP_ENABLED=false is a hard off that the table cannot override;
 * otherwise the table row (default: enabled) decides.
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { platformSettings } from "@shared/schema";

export const SIGNUP_ENABLED_KEY = "signup_enabled";

export interface SignupState { enabled: boolean; source: "env" | "setting" | "default"; message?: string | null }

let cache: { at: number; value: SignupState } | null = null;
const CACHE_MS = 30 * 1000;

export function envSignupDisabled(): boolean {
  return (process.env.SIGNUP_ENABLED || "").trim().toLowerCase() === "false";
}

export async function getSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, key));
  return row ? (row.value as T) : null;
}

export async function setSetting(key: string, value: unknown, userId: string | null): Promise<void> {
  await db.insert(platformSettings).values({ key, value: value as any, updatedByUserId: userId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value: value as any, updatedByUserId: userId, updatedAt: new Date() } });
  cache = null;
}

export async function signupState(): Promise<SignupState> {
  if (envSignupDisabled()) return { enabled: false, source: "env", message: "New signups are paused right now. Please check back soon." };
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value: SignupState = { enabled: true, source: "default" };
  try {
    const row = await getSetting<{ enabled?: boolean; message?: string | null }>(SIGNUP_ENABLED_KEY);
    if (row && row.enabled === false) value = { enabled: false, source: "setting", message: row.message || "New signups are paused right now. Please check back soon." };
  } catch (err) {
    console.warn("[platform-settings] signup_enabled lookup failed; defaulting to enabled", (err as Error).message);
  }
  cache = { at: Date.now(), value };
  return value;
}

export function resetPlatformSettingsCache(): void { cache = null; }
