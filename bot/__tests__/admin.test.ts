import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { isAdmin } from "../services/admin.service";
import { config } from "../config";

describe("admin.service", () => {
  describe("isAdmin", () => {
    const originalAdminIds = config.ADMIN_TELEGRAM_IDS;

    beforeAll(() => {
      // Set test admin IDs
      (config as any).ADMIN_TELEGRAM_IDS = ["123456789", "987654321"];
    });

    afterAll(() => {
      // Restore original admin IDs
      (config as any).ADMIN_TELEGRAM_IDS = originalAdminIds;
    });

    test("should return true for admin user", () => {
      expect(isAdmin("123456789")).toBe(true);
      expect(isAdmin("987654321")).toBe(true);
    });

    test("should return false for non-admin user", () => {
      expect(isAdmin("111111111")).toBe(false);
      expect(isAdmin("")).toBe(false);
    });
  });
});
