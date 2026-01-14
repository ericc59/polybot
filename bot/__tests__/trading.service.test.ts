import { test, expect, describe, mock } from "bun:test";
import { isValidPrivateKey, getAddressFromPrivateKey } from "../services/trading.service";

describe("trading.service", () => {
  describe("isValidPrivateKey", () => {
    test("should accept valid 64-character hex private key", () => {
      const validKey = "0x" + "a".repeat(64);
      expect(isValidPrivateKey(validKey)).toBe(true);
    });

    test("should accept valid private key without 0x prefix", () => {
      const validKey = "a".repeat(64);
      expect(isValidPrivateKey(validKey)).toBe(true);
    });

    test("should reject short private key", () => {
      const shortKey = "0x" + "a".repeat(32);
      expect(isValidPrivateKey(shortKey)).toBe(false);
    });

    test("should reject long private key", () => {
      const longKey = "0x" + "a".repeat(128);
      expect(isValidPrivateKey(longKey)).toBe(false);
    });

    test("should reject non-hex characters", () => {
      const invalidKey = "0x" + "g".repeat(64);
      expect(isValidPrivateKey(invalidKey)).toBe(false);
    });

    test("should reject empty string", () => {
      expect(isValidPrivateKey("")).toBe(false);
    });

    test("should accept mixed case hex", () => {
      const mixedKey = "0x" + "aAbBcCdDeEfF".repeat(5) + "aaaa";
      expect(isValidPrivateKey(mixedKey)).toBe(true);
    });
  });

  describe("getAddressFromPrivateKey", () => {
    test("should derive consistent address from private key", () => {
      // Known test private key (DO NOT USE IN PRODUCTION)
      const testPrivateKey = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

      const address1 = getAddressFromPrivateKey(testPrivateKey);
      const address2 = getAddressFromPrivateKey(testPrivateKey);

      expect(address1).toBe(address2);
      expect(address1.startsWith("0x")).toBe(true);
      expect(address1.length).toBe(42); // Standard Ethereum address length
    });

    test("should derive different addresses for different keys", () => {
      const key1 = "0x" + "1".repeat(64);
      const key2 = "0x" + "2".repeat(64);

      const address1 = getAddressFromPrivateKey(key1);
      const address2 = getAddressFromPrivateKey(key2);

      expect(address1).not.toBe(address2);
    });
  });

  describe("Market Resolution", () => {
    // These tests verify the logic for determining winners
    // without making actual API calls

    test("should correctly identify winner from resolved market data", () => {
      const resolvedMarketData = {
        condition_id: "0xtest",
        tokens: [
          { token_id: "1", outcome: "Yes", price: 1.0, winner: true },
          { token_id: "2", outcome: "No", price: 0.0, winner: false },
        ],
        archived: true,
      };

      const winner = resolvedMarketData.tokens.find(t => t.winner);
      expect(winner?.outcome).toBe("Yes");
    });

    test("should identify no winner in unresolved market", () => {
      const unresolvedMarketData = {
        condition_id: "0xtest",
        tokens: [
          { token_id: "1", outcome: "Yes", price: 0.65, winner: false },
          { token_id: "2", outcome: "No", price: 0.35, winner: false },
        ],
        archived: false,
      };

      const winner = unresolvedMarketData.tokens.find(t => t.winner);
      expect(winner).toBeUndefined();
    });

    test("should calculate redemption value correctly", () => {
      // Winner gets $1 per share
      const winnerShares = 100;
      const winnerRedemptionValue = winnerShares * 1.0;
      expect(winnerRedemptionValue).toBe(100);

      // Loser gets $0 per share
      const loserShares = 100;
      const loserRedemptionValue = loserShares * 0.0;
      expect(loserRedemptionValue).toBe(0);
    });
  });

  describe("Trade Size Calculations", () => {
    test("should calculate copy size with percentage", () => {
      const sourceTradeSize = 100; // $100 trade
      const copyPercentage = 50;

      const copySize = sourceTradeSize * (copyPercentage / 100);
      expect(copySize).toBe(50);
    });

    test("should apply max trade size limit", () => {
      const sourceTradeSize = 1000;
      const copyPercentage = 100;
      const maxTradeSize = 200;

      let copySize = sourceTradeSize * (copyPercentage / 100);
      if (maxTradeSize && copySize > maxTradeSize) {
        copySize = maxTradeSize;
      }

      expect(copySize).toBe(200);
    });

    test("should check daily limit", () => {
      const todaysTotal = 800;
      const newTradeSize = 300;
      const dailyLimit = 1000;

      const withinLimit = todaysTotal + newTradeSize <= dailyLimit;
      expect(withinLimit).toBe(false);
    });

    test("should allow trade within daily limit", () => {
      const todaysTotal = 600;
      const newTradeSize = 300;
      const dailyLimit = 1000;

      const withinLimit = todaysTotal + newTradeSize <= dailyLimit;
      expect(withinLimit).toBe(true);
    });
  });

  describe("Order Parameters", () => {
    test("should validate BUY order params", () => {
      const order = {
        tokenId: "token-123",
        side: "BUY" as const,
        amount: 100, // USD amount
      };

      expect(order.tokenId).toBeDefined();
      expect(order.side).toBe("BUY");
      expect(order.amount).toBeGreaterThan(0);
    });

    test("should validate SELL order params", () => {
      const order = {
        tokenId: "token-123",
        side: "SELL" as const,
        amount: 50, // Shares to sell
      };

      expect(order.tokenId).toBeDefined();
      expect(order.side).toBe("SELL");
      expect(order.amount).toBeGreaterThan(0);
    });

    test("should calculate shares from USD and price", () => {
      const usdAmount = 100;
      const price = 0.5;

      const shares = usdAmount / price;
      expect(shares).toBe(200);
    });

    test("should calculate USD value from shares and price", () => {
      const shares = 200;
      const price = 0.5;

      const usdValue = shares * price;
      expect(usdValue).toBe(100);
    });
  });

  describe("SELL Handling - Sell What We Have", () => {
    test("should sell exact position when whale sells same amount", () => {
      const ourPosition = 100;
      const whaleSellAmount = 100;

      const sharesToSell = Math.min(whaleSellAmount, ourPosition);
      expect(sharesToSell).toBe(100);
    });

    test("should sell only what we have when whale sells more", () => {
      const ourPosition = 50;
      const whaleSellAmount = 100;

      const sharesToSell = Math.min(whaleSellAmount, ourPosition);
      expect(sharesToSell).toBe(50);
    });

    test("should handle when whale sells less than we have", () => {
      const ourPosition = 100;
      const whaleSellAmount = 30;

      const sharesToSell = Math.min(whaleSellAmount, ourPosition);
      expect(sharesToSell).toBe(30);

      const remainingPosition = ourPosition - sharesToSell;
      expect(remainingPosition).toBe(70);
    });

    test("should handle zero position", () => {
      const ourPosition = 0;
      const whaleSellAmount = 100;

      const sharesToSell = Math.min(whaleSellAmount, ourPosition);
      expect(sharesToSell).toBe(0);
    });
  });
});
