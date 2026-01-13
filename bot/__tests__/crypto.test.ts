import { test, expect, describe } from "bun:test";
import { encrypt, decrypt, encryptCredentials, decryptCredentials, generatePassphrase } from "../utils/crypto";

describe("crypto", () => {
  describe("encrypt/decrypt", () => {
    test("should encrypt and decrypt a string", () => {
      const original = "hello world";
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    test("should produce different ciphertext for same plaintext", () => {
      const original = "test message";
      const encrypted1 = encrypt(original);
      const encrypted2 = encrypt(original);
      expect(encrypted1).not.toBe(encrypted2);
    });

    test("should handle empty string", () => {
      const original = "";
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    test("should handle unicode characters", () => {
      const original = "こんにちは 🚀 مرحبا";
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    test("should handle long strings", () => {
      const original = "a".repeat(10000);
      const encrypted = encrypt(original);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(original);
    });

    test("should throw on invalid encrypted data format", () => {
      expect(() => decrypt("invalid")).toThrow("Invalid encrypted data format");
    });

    test("should throw on tampered data", () => {
      const encrypted = encrypt("test");
      const parts = encrypted.split(":");
      // Tamper with the auth tag
      parts[1] = "0000000000000000000000000000000000";
      const tampered = parts.join(":");
      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe("encryptCredentials/decryptCredentials", () => {
    test("should encrypt and decrypt credentials object", () => {
      const credentials = {
        apiKey: "test-api-key",
        apiSecret: "test-api-secret",
        passphrase: "test-passphrase",
      };
      const encrypted = encryptCredentials(credentials);
      const decrypted = decryptCredentials(encrypted);
      expect(decrypted).toEqual(credentials);
    });
  });

  describe("generatePassphrase", () => {
    test("should generate a base64 passphrase", () => {
      const passphrase = generatePassphrase();
      expect(passphrase).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(passphrase.length).toBeGreaterThan(30);
    });

    test("should generate unique passphrases", () => {
      const passphrase1 = generatePassphrase();
      const passphrase2 = generatePassphrase();
      expect(passphrase1).not.toBe(passphrase2);
    });
  });
});
