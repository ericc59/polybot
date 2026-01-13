import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// Get encryption key from environment or generate one
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "default-dev-key-change-in-production";

// Derive a 32-byte key from the password
function getKey(): Buffer {
  return scryptSync(ENCRYPTION_KEY, "polybot-salt", 32);
}

/**
 * Encrypt sensitive data (API keys, secrets)
 * Uses AES-256-GCM for authenticated encryption
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt sensitive data
 */
export function decrypt(encryptedData: string): string {
  const key = getKey();
  const parts = encryptedData.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const [ivHex, authTagHex, encrypted] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");

  return decrypted;
}

/**
 * Encrypt trading credentials (API key + secret + passphrase)
 */
export function encryptCredentials(credentials: {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}): string {
  return encrypt(JSON.stringify(credentials));
}

/**
 * Decrypt trading credentials
 */
export function decryptCredentials(encrypted: string): {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
} {
  const decrypted = decrypt(encrypted);
  return JSON.parse(decrypted);
}

/**
 * Generate a secure random passphrase for wallet connections
 */
export function generatePassphrase(): string {
  return randomBytes(32).toString("base64");
}
