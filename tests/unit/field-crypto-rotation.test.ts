import { describe, it, expect, afterEach } from "vitest";
import { createCipheriv, randomBytes, scryptSync } from "crypto";
import { encryptField, decryptField } from "../../server/storage";
import { encryptSmtpPassword, decryptSmtpPassword } from "../../server/email";

// A second, distinct 64-hex key to play the role of the previous ("old") key
// during a rotation. Differs from the test harness's BANKING/SMTP keys.
const OTHER_KEY = "f".repeat(64);

// Reproduce the production banking ciphertext format under an arbitrary key, so
// we can prove the old-key fallback reads data written under a different key
// without needing to reload the module with a different primary key.
function bankingEncryptUnder(secret: string, plaintext: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(secret, salt, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    "enc:v2:" +
    salt.toString("hex") + ":" +
    iv.toString("hex") + ":" +
    tag.toString("hex") + ":" +
    enc.toString("hex")
  );
}

function smtpEncryptUnder(secret: string, plaintext: string): string {
  const salt = randomBytes(16);
  // email.ts derives the SMTP key from the salt's hex string, not the raw bytes.
  const key = scryptSync(secret, salt.toString("hex"), 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    "v2:" +
    salt.toString("hex") + ":" +
    iv.toString("hex") + ":" +
    tag.toString("hex") + ":" +
    enc.toString("hex")
  );
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

  it("decrypts ciphertext written under the OLD key once BANKING_ENCRYPTION_KEY_OLD is set", () => {
    const oldCt = bankingEncryptUnder(OTHER_KEY, "123456789");
    // Without the old key configured, the current key cannot (and must not) read it.
    expect(() => decryptField(oldCt)).toThrow();
    // With the old key configured as the rotation fallback, it decrypts.
    process.env.BANKING_ENCRYPTION_KEY_OLD = OTHER_KEY;
    expect(decryptField(oldCt)).toBe("123456789");
  });

  it("still reads current-key data while the old key is configured", () => {
    process.env.BANKING_ENCRYPTION_KEY_OLD = OTHER_KEY;
    const ct = encryptField("current-data");
    expect(decryptField(ct)).toBe("current-data");
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

  it("decrypts ciphertext written under the OLD key once SMTP_ENCRYPTION_KEY_OLD is set", () => {
    const oldCt = smtpEncryptUnder(OTHER_KEY, "old-smtp-pass");
    expect(() => decryptSmtpPassword(oldCt)).toThrow();
    process.env.SMTP_ENCRYPTION_KEY_OLD = OTHER_KEY;
    expect(decryptSmtpPassword(oldCt)).toBe("old-smtp-pass");
  });

  it("passes plaintext without a delimiter through unchanged", () => {
    expect(decryptSmtpPassword("plaintextpw")).toBe("plaintextpw");
  });
});
