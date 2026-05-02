import bcrypt from "bcryptjs";
import { timingSafeEqual, randomBytes } from "crypto";

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "12", 10);
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_REGEX_UPPER = /[A-Z]/;
const PASSWORD_REGEX_LOWER = /[a-z]/;
const PASSWORD_REGEX_DIGIT = /[0-9]/;

export function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (!PASSWORD_REGEX_UPPER.test(password)) {
    return "Password must contain at least 1 uppercase letter";
  }
  if (!PASSWORD_REGEX_LOWER.test(password)) {
    return "Password must contain at least 1 lowercase letter";
  }
  if (!PASSWORD_REGEX_DIGIT.test(password)) {
    return "Password must contain at least 1 number";
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function comparePasswords(
  supplied: string,
  stored: string,
): Promise<boolean> {
  if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
    return bcrypt.compare(supplied, stored);
  }
  const { scrypt } = await import("crypto");
  const { promisify } = await import("util");
  const scryptAsync = promisify(scrypt);
  const [hashed, salt] = stored.split(".");
  if (!hashed || !salt) return false;
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

export function needsRehash(storedHash: string): boolean {
  if (!storedHash.startsWith("$2a$") && !storedHash.startsWith("$2b$") && !storedHash.startsWith("$2y$")) {
    return true;
  }
  const roundsMatch = storedHash.match(/^\$2[aby]\$(\d+)\$/);
  if (!roundsMatch) return true;
  return parseInt(roundsMatch[1], 10) < BCRYPT_ROUNDS;
}

export async function rehashAndUpdate(plainPassword: string, storedHash: string, userId: string, orgId: string): Promise<void> {
  if (!needsRehash(storedHash)) return;
  try {
    const { storage } = await import("./storage");
    const newHash = await hashPassword(plainPassword);
    await storage.updateUser(userId, orgId, { password: newHash });
    console.log(`[auth] Rehashed password for user ${userId} (upgraded to ${BCRYPT_ROUNDS} rounds)`);
  } catch (err) {
    console.error("[auth] Failed to rehash password:", err);
  }
}
