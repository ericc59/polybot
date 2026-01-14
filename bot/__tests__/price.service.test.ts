import { test, expect, describe, beforeEach } from "bun:test";
import {
  updatePrice,
  getPrice,
  getPriceEntry,
  getAllPrices,
  cleanupStalePrices,
  getCacheStats,
} from "../services/price.service";

describe("price.service", () => {
  beforeEach(() => {
    // Clear cache by cleaning up all stale prices with 0ms max age
    // This is a workaround since we can't directly clear the cache
    cleanupStalePrices();
  });

  describe("updatePrice / getPrice", () => {
    test("should store and retrieve a price", () => {
      updatePrice("condition-123", 0.65, "Test Market", "Yes");

      const price = getPrice("condition-123");
      expect(price).toBe(0.65);
    });

    test("should return null for unknown condition", () => {
      const price = getPrice("unknown-condition");
      expect(price).toBeNull();
    });

    test("should update existing price", () => {
      updatePrice("condition-123", 0.50);
      updatePrice("condition-123", 0.75);

      const price = getPrice("condition-123");
      expect(price).toBe(0.75);
    });
  });

  describe("getPriceEntry", () => {
    test("should return price with metadata", () => {
      updatePrice("condition-456", 0.80, "Another Market", "No");

      const entry = getPriceEntry("condition-456");
      expect(entry).not.toBeNull();
      expect(entry?.price).toBe(0.80);
      expect(entry?.title).toBe("Another Market");
      expect(entry?.outcome).toBe("No");
      expect(entry?.timestamp).toBeGreaterThan(0);
    });

    test("should return null for unknown condition", () => {
      const entry = getPriceEntry("unknown");
      expect(entry).toBeNull();
    });
  });

  describe("getAllPrices", () => {
    test("should return all cached prices", () => {
      updatePrice("cond-1", 0.10);
      updatePrice("cond-2", 0.20);
      updatePrice("cond-3", 0.30);

      const all = getAllPrices();
      expect(all.size).toBeGreaterThanOrEqual(3);
      expect(all.get("cond-1")?.price).toBe(0.10);
      expect(all.get("cond-2")?.price).toBe(0.20);
      expect(all.get("cond-3")?.price).toBe(0.30);
    });
  });

  describe("getCacheStats", () => {
    test("should return cache size", () => {
      updatePrice("stats-cond-1", 0.50);
      updatePrice("stats-cond-2", 0.60);

      const stats = getCacheStats();
      expect(stats.size).toBeGreaterThanOrEqual(2);
    });

    test("should return oldest entry age", () => {
      updatePrice("stats-cond-3", 0.70);

      const stats = getCacheStats();
      // Should be very recent (less than 1 second old)
      expect(stats.oldestMs).toBeLessThan(1000);
    });
  });

  describe("cleanupStalePrices", () => {
    test("should not remove fresh prices", () => {
      updatePrice("fresh-cond", 0.90);

      const cleaned = cleanupStalePrices();
      // Fresh prices should not be cleaned
      expect(getPrice("fresh-cond")).toBe(0.90);
    });
  });

  describe("price formatting", () => {
    test("should handle price edge cases", () => {
      // Zero price
      updatePrice("zero-price", 0);
      expect(getPrice("zero-price")).toBe(0);

      // Very small price
      updatePrice("small-price", 0.001);
      expect(getPrice("small-price")).toBe(0.001);

      // Price at 1 (resolved winner)
      updatePrice("winner-price", 1.0);
      expect(getPrice("winner-price")).toBe(1.0);
    });
  });
});
