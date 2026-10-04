import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SecurityError, UsageError } from "./errors.js";

const scrypt = promisify(scryptCallback);
const PROFILE = Object.freeze({ N: 16_384, r: 8, p: 1, keyLength: 32, maxmem: 64 * 1024 * 1024 });
const MAX_CIPHERTEXT_BYTES = 12 * 1024 * 1024;

async function deriveKey(passphrase, salt) {
  if (!Buffer.isBuffer(passphrase) || passphrase.length < 12 || passphrase.length > 1_024) {
    throw new UsageError("Passphrase must be 12 to 1,024 bytes.");
  }
  return scrypt(passphrase, salt, PROFILE.keyLength, PROFILE);
}

function decodeBase64(value, expectedLength, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new SecurityError(`${label} is not valid base64.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedLength) throw new SecurityError(`${label} has an invalid length.`);
  return decoded;
}

export async function encryptArchive(plaintext, passphrase) {
  if (!Buffer.isBuffer(plaintext) || plaintext.length === 0 || plaintext.length > MAX_CIPHERTEXT_BYTES) {
    throw new UsageError("Archive must be a non-empty file no larger than 12 MiB.");
  }
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${JSON.stringify({
      schema: "aicx-envelope/0.1",
      kdf: { name: "scrypt", N: PROFILE.N, r: PROFILE.r, p: PROFILE.p, salt: salt.toString("base64") },
      cipher: { name: "aes-256-gcm", nonce: nonce.toString("base64"), tag: tag.toString("base64") },
      ciphertext: ciphertext.toString("base64"),
    })}\n`;
  } finally {
    key.fill(0);
  }
}

export async function decryptArchive(envelopeText, passphrase) {
  let envelope;
  try {
    envelope = JSON.parse(envelopeText);
  } catch {
    throw new SecurityError("Encrypted archive is not valid JSON.");
  }
  if (
    !envelope ||
    envelope.schema !== "aicx-envelope/0.1" ||
    !envelope.kdf ||
    envelope.kdf.name !== "scrypt" ||
    envelope.kdf.N !== PROFILE.N ||
    envelope.kdf.r !== PROFILE.r ||
    envelope.kdf.p !== PROFILE.p ||
    !envelope.cipher ||
    envelope.cipher.name !== "aes-256-gcm" ||
    typeof envelope.ciphertext !== "string" ||
    envelope.ciphertext.length > MAX_CIPHERTEXT_BYTES * 2
  ) {
    throw new SecurityError("Encrypted archive uses an unsupported or unsafe envelope.");
  }
  const salt = decodeBase64(envelope.kdf.salt, 16, "KDF salt");
  const nonce = decodeBase64(envelope.cipher.nonce, 12, "Cipher nonce");
  const tag = decodeBase64(envelope.cipher.tag, 16, "Cipher tag");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  if (ciphertext.length === 0 || ciphertext.length > MAX_CIPHERTEXT_BYTES) {
    throw new SecurityError("Ciphertext has an invalid length.");
  }
  const key = await deriveKey(passphrase, salt);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new SecurityError("Unable to decrypt archive: wrong passphrase or altered ciphertext.");
  } finally {
    key.fill(0);
  }
}

export function samePassphrase(first, second) {
  if (!Buffer.isBuffer(first) || !Buffer.isBuffer(second) || first.length !== second.length) return false;
  return timingSafeEqual(first, second);
}
