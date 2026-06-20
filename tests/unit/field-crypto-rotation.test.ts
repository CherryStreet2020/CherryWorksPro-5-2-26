import { describe, it, expect, afterEach } from "vitest";
import { createCipheriv, randomBytes, scryptSync } from "crypto";

// Seed the field-crypto keys BEFORE importing the modules that capture them at
// load time: storage.ts throws without BANKING_ENCRYPTION_KEY and email.ts
// silently stores plaintext (no "v2:" prefix) without SMTP_ENCRYPTION_KEY, so a
// clean shell without the cwp harness env would otherwise break this suite.
// Mirrors the tests/email/* convention. `||` keeps the real harness keys when set.
process.env.BANKING_ENCRYPTION_KEY =
  process.env.BANKING_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.SMTP_ENCRYPTION_KEY =
  process.env.SMTP_ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { encryptField, decryptField } from "../../server/storage";
import { encryptSmtpPassword, decryptSmtpPassword } from "../../server/email";

// Distinct 64-hex keys standing in for the previous ("old") key and a third,
// unrelated key during a rotation. All differ from the harness BANKING/SMTP keys.
const OTHER_KEY = "f".repeat(64);
const THIRD_KEY = "c".repeat(64);

// Node's AES-GCM authentication error message (wrong key or tampered ciphertext).
const GCM_AUTH_ERROR = /unable to authenticate data/i;

// Salts the legacy (pre-v2) formats derive their key from.
const LEGACY_BANKING_SALT = "cherryworks-banking-salt";
const LEGACY_SMTP_SALT = "cherryworks-smtp-salt";

// --- Faithful reproductions of the production ciphertext formats under an
// --- arbitrary key, so the old-key fallback can be proven for data written
// --- under a different key, in BOTH the v2 and the legacy formats.

function bankingEncryptV2(secret: string, plaintext: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(secret, salt, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "enc:v2:" + salt.toString("hex") + ":" + iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

function bankingEncryptLegacy(secret: string, plaintext: string): string {
  const key = scryptSync(secret, LEGACY_BANKING_SALT, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "enc:" + iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

function smtpEncryptV2(secret: string, plaintext: string): string {
  const salt = randomBytes(16);
  // email.ts derives the SMTP key from the salt's hex string, not the raw bytes.
  const key = scryptSync(secret, salt.toString("hex"), 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "v2:" + salt.toString("hex") + ":" + iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

function smtpEncryptLegacy(secret: string, plaintext: string): string {
  const key = scryptSync(secret, LEGACY_SMTP_SALT, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

// Flip one hex nibble in the final (ciphertext-body) segment to simulate
// in-place tampering of an otherwise-valid blob.
function tamperLastSegment(ciphertext: string): string {
  const parts = ciphertext.split(":");
  const body = parts[parts.length - 1];
  parts[parts.length - 1] = (body[0] === "0" ? "1" : "0") + body.slice(1);
  return parts.join(":");
}

describe("banking field crypto — key rotation fallback", () => {
  afterEach(() => {
    delete process.env.BANKING_ENCRYPTION_KEY_OLD;
  });

  it("round-trips with the current key (no rotation configured)", () => {
    const ct = encryptField("021000021");
    expect(ct.startsWith("enc:v2:")).toBe(true);
    expect(decryptField(ct)).toBe("021000021");
  });

  it("decrypts v2 ciphertext written under the OLD key once BANKING_ENCRYPTION_KEY_OLD is set", () => {
    const oldCt = bankingEncryptV2(OTHER_KEY, "123456789");
    // Without the old key configured, the current key cannot (and must not) read it.
    expect(() => decryptField(oldCt)).toThrow(GCM_AUTH_ERROR);
    // It must surface the real GCM error, not the generic fallback message.
    expect(() => decryptField(oldCt)).not.toThrow(/any configured key/);
    // With the old key configured as the rotation fallback, it decrypts.
    process.env.BANKING_ENCRYPTION_KEY_OLD = OTHER_KEY;
    expect(decryptField(oldCt)).toBe("123456789");
  });

  it("decrypts LEGACY-format ciphertext under both the current and the OLD key", () => {
    // Legacy data written under the current key reads with no rotation configured.
    const legacyCurrent = bankingEncryptLegacy(process.env.BANKING_ENCRYPTION_KEY as string, "current-legacy");
    expect(decryptField(legacyCurrent)).toBe("current-legacy");
    // Legacy data written under the OLD key needs the fallback (this is the
    // branch most likely to hold real data during the rotation).
    const legacyOld = bankingEncryptLegacy(OTHER_KEY, "old-legacy");
    expect(() => decryptField(legacyOld)).toThrow(GCM_AUTH_ERROR);
    process.env.BANKING_ENCRYPTION_KEY_OLD = OTHER_KEY;
    expect(decryptField(legacyOld)).toBe("old-legacy");
  });

  it("still reads current-key data while the old key is configured", () => {
    process.env.BANKING_ENCRYPTION_KEY_OLD = OTHER_KEY;
    const ct = encryptField("current-data");
    expect(decryptField(ct)).toBe("current-data");
  });

  it("throws on tampered ciphertext under the correct key (GCM authenticity)", () => {
    const ct = encryptField("021000021");
    expect(() => decryptField(tamperLastSegment(ct))).toThrow(GCM_AUTH_ERROR);
  });

  it("throws when neither the current nor the old key matches", () => {
    process.env.BANKING_ENCRYPTION_KEY_OLD = OTHER_KEY;
    const foreign = bankingEncryptV2(THIRD_KEY, "unreadable");
    expect(() => decryptField(foreign)).toThrow(GCM_AUTH_ERROR);
  });

  it("passes non-encrypted values through unchanged", () => {
    expect(decryptField("not-encrypted")).toBe("not-encrypted");
  });
});

describe("SMTP secret crypto — key rotation fallback", () => {
  afterEach(() => {
    delete process.env.SMTP_ENCRYPTION_KEY_OLD;
  });

  it("round-trips with the current key (no rotation configured)", () => {
    const ct = encryptSmtpPassword("hunter2");
    expect(ct.startsWith("v2:")).toBe(true);
    expect(decryptSmtpPassword(ct)).toBe("hunter2");
  });

  it("decrypts v2 ciphertext written under the OLD key once SMTP_ENCRYPTION_KEY_OLD is set", () => {
    const oldCt = smtpEncryptV2(OTHER_KEY, "old-smtp-pass");
    expect(() => decryptSmtpPassword(oldCt)).toThrow(GCM_AUTH_ERROR);
    expect(() => decryptSmtpPassword(oldCt)).not.toThrow(/any configured key/);
    process.env.SMTP_ENCRYPTION_KEY_OLD = OTHER_KEY;
    expect(decryptSmtpPassword(oldCt)).toBe("old-smtp-pass");
  });

  it("decrypts LEGACY-format ciphertext under both the current and the OLD key", () => {
    const legacyCurrent = smtpEncryptLegacy(process.env.SMTP_ENCRYPTION_KEY as string, "current-legacy-smtp");
    expect(decryptSmtpPassword(legacyCurrent)).toBe("current-legacy-smtp");
    const legacyOld = smtpEncryptLegacy(OTHER_KEY, "old-legacy-smtp");
    expect(() => decryptSmtpPassword(legacyOld)).toThrow(GCM_AUTH_ERROR);
    process.env.SMTP_ENCRYPTION_KEY_OLD = OTHER_KEY;
    expect(decryptSmtpPassword(legacyOld)).toBe("old-legacy-smtp");
  });

  it("still reads current-key data while the old key is configured", () => {
    process.env.SMTP_ENCRYPTION_KEY_OLD = OTHER_KEY;
    const ct = encryptSmtpPassword("current-smtp-pass");
    expect(decryptSmtpPassword(ct)).toBe("current-smtp-pass");
  });

  it("throws on tampered ciphertext under the correct key (GCM authenticity)", () => {
    const ct = encryptSmtpPassword("hunter2");
    expect(() => decryptSmtpPassword(tamperLastSegment(ct))).toThrow(GCM_AUTH_ERROR);
  });

  it("passes plaintext without a delimiter through unchanged", () => {
    expect(decryptSmtpPassword("plaintextpw")).toBe("plaintextpw");
  });
});
