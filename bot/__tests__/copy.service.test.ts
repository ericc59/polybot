import { test, expect, describe, beforeEach, afterEach, beforeAll } from "bun:test";
import { db, getDb } from "../db/index";
import * as copyService from "../services/copy.service";

// Test user ID
const TEST_USER_ID = 88888;
const TEST_WALLET = "0xtest1234567890";

describe("copy.service", () => {
  beforeAll(async () => {
    // Initialize database
    await getDb();
  });

  beforeEach(() => {
    // Clean up test data
    cleanupTestData();

    // Create test user
    try {
      db().exec(`
        INSERT OR IGNORE INTO users (id, telegram_id, telegram_chat_id, telegram_username, is_active)
        VALUES (${TEST_USER_ID}, 'test_${TEST_USER_ID}', 'chat_${TEST_USER_ID}', 'testuser', 1)
      `);
    } catch (e) {
      // User might already exist
    }
  });

  afterEach(() => {
    cleanupTestData();
  });

  function cleanupTestData() {
    try {
      db().exec(`DELETE FROM copy_trade_history WHERE user_id = ${TEST_USER_ID}`);
      db().exec(`DELETE FROM user_copy_subscriptions WHERE user_id = ${TEST_USER_ID}`);
      db().exec(`DELETE FROM user_trading_wallets WHERE user_id = ${TEST_USER_ID}`);
    } catch (e) {
      // Tables might not exist
    }
  }

  describe("Copy Subscriptions", () => {
    describe("subscribeToCopy", () => {
      test("should subscribe to a wallet in recommend mode", () => {
        const result = copyService.subscribeToCopy(TEST_USER_ID, TEST_WALLET, "recommend");
        expect(result).toBe(true);

        const subs = copyService.getCopySubscriptions(TEST_USER_ID);
        expect(subs.length).toBe(1);
        expect(subs[0]!.sourceWallet).toBe(TEST_WALLET.toLowerCase());
        expect(subs[0]!.mode).toBe("recommend");
      });

      test("should subscribe to a wallet in auto mode", () => {
        const result = copyService.subscribeToCopy(TEST_USER_ID, TEST_WALLET, "auto");
        expect(result).toBe(true);

        const subs = copyService.getCopySubscriptions(TEST_USER_ID);
        expect(subs[0]!.mode).toBe("auto");
      });

      test("should update mode on duplicate subscription", () => {
        copyService.subscribeToCopy(TEST_USER_ID, TEST_WALLET, "recommend");
        copyService.subscribeToCopy(TEST_USER_ID, TEST_WALLET, "auto");

        const subs = copyService.getCopySubscriptions(TEST_USER_ID);
        expect(subs.length).toBe(1);
        expect(subs[0]!.mode).toBe("auto");
      });

      test("should normalize wallet address to lowercase", () => {
        copyService.subscribeToCopy(TEST_USER_ID, "0xABCDEF", "recommend");

        const subs = copyService.getCopySubscriptions(TEST_USER_ID);
        expect(subs[0]!.sourceWallet).toBe("0xabcdef");
      });

      test("should allow multiple wallet subscriptions", () => {
        copyService.subscribeToCopy(TEST_USER_ID, "0xwallet1", "recommend");
        copyService.subscribeToCopy(TEST_USER_ID, "0xwallet2", "auto");
        copyService.subscribeToCopy(TEST_USER_ID, "0xwallet3", "recommend");

        const subs = copyService.getCopySubscriptions(TEST_USER_ID);
        expect(subs.length).toBe(3);
      });
    });

    describe("unsubscribeFromCopy", () => {
      test("should unsubscribe from a wallet", () => {
        copyService.subscribeToCopy(TEST_USER_ID, TEST_WALLET, "recommend");
        const result = copyService.unsubscribeFromCopy(TEST_USER_ID, TEST_WALLET);

        expect(result).toBe(true);

        const subs = copyService.getCopySubscriptions(TEST_USER_ID);
        expect(subs.length).toBe(0);
      });

      test("should return true even if wallet not subscribed", () => {
        const result = copyService.unsubscribeFromCopy(TEST_USER_ID, "0xunknown");
        expect(result).toBe(true);
      });

      test("should only unsubscribe specified wallet", () => {
        copyService.subscribeToCopy(TEST_USER_ID, "0xwallet1", "recommend");
        copyService.subscribeToCopy(TEST_USER_ID, "0xwallet2", "auto");

        copyService.unsubscribeFromCopy(TEST_USER_ID, "0xwallet1");

        const subs = copyService.getCopySubscriptions(TEST_USER_ID);
        expect(subs.length).toBe(1);
        expect(subs[0]!.sourceWallet).toBe("0xwallet2");
      });
    });

    describe("getCopySubscriptions", () => {
      test("should return empty array for user with no subscriptions", () => {
        const subs = copyService.getCopySubscriptions(TEST_USER_ID);
        expect(subs).toBeInstanceOf(Array);
        expect(subs.length).toBe(0);
      });

      test("should return all subscriptions for user", () => {
        copyService.subscribeToCopy(TEST_USER_ID, "0xwallet1", "recommend");
        copyService.subscribeToCopy(TEST_USER_ID, "0xwallet2", "auto");

        const subs = copyService.getCopySubscriptions(TEST_USER_ID);
        expect(subs.length).toBe(2);
      });
    });
  });

  describe("Trading Wallets", () => {
    describe("saveTradingWallet", () => {
      test("should save a new trading wallet", () => {
        const result = copyService.saveTradingWallet(
          TEST_USER_ID,
          "0xmywallet",
          "encrypted_creds_here"
        );

        expect(result).toBe(true);

        const wallet = copyService.getTradingWallet(TEST_USER_ID);
        expect(wallet).not.toBeNull();
        expect(wallet?.walletAddress).toBe("0xmywallet");
      });

      test("should update existing trading wallet", () => {
        copyService.saveTradingWallet(TEST_USER_ID, "0xwallet1", "creds1");
        copyService.saveTradingWallet(TEST_USER_ID, "0xwallet2", "creds2");

        const wallet = copyService.getTradingWallet(TEST_USER_ID);
        expect(wallet?.walletAddress).toBe("0xwallet2");
      });
    });

    describe("getTradingWallet", () => {
      test("should return null for user with no wallet", () => {
        const wallet = copyService.getTradingWallet(TEST_USER_ID);
        expect(wallet).toBeNull();
      });

      test("should return wallet with default settings", () => {
        copyService.saveTradingWallet(TEST_USER_ID, "0xmywallet", "creds");

        const wallet = copyService.getTradingWallet(TEST_USER_ID);
        expect(wallet?.copyEnabled).toBeFalsy(); // Default disabled
        expect(wallet?.copyPercentage).toBe(10); // Default 10%
      });
    });

    describe("updateTradingSettings", () => {
      beforeEach(() => {
        copyService.saveTradingWallet(TEST_USER_ID, "0xmywallet", "creds");
      });

      test("should update copyEnabled", () => {
        copyService.updateTradingSettings(TEST_USER_ID, { copyEnabled: true });

        const wallet = copyService.getTradingWallet(TEST_USER_ID);
        expect(wallet?.copyEnabled).toBeTruthy();
      });

      test("should update copyPercentage", () => {
        copyService.updateTradingSettings(TEST_USER_ID, { copyPercentage: 50 });

        const wallet = copyService.getTradingWallet(TEST_USER_ID);
        expect(wallet?.copyPercentage).toBe(50);
      });

      test("should update maxTradeSize", () => {
        copyService.updateTradingSettings(TEST_USER_ID, { maxTradeSize: 100 });

        const wallet = copyService.getTradingWallet(TEST_USER_ID);
        expect(wallet?.maxTradeSize).toBe(100);
      });

      test("should update dailyLimit", () => {
        copyService.updateTradingSettings(TEST_USER_ID, { dailyLimit: 500 });

        const wallet = copyService.getTradingWallet(TEST_USER_ID);
        expect(wallet?.dailyLimit).toBe(500);
      });

      test("should update multiple settings at once", () => {
        copyService.updateTradingSettings(TEST_USER_ID, {
          copyEnabled: true,
          copyPercentage: 75,
          maxTradeSize: 200,
          dailyLimit: 1000,
        });

        const wallet = copyService.getTradingWallet(TEST_USER_ID);
        expect(wallet?.copyEnabled).toBeTruthy();
        expect(wallet?.copyPercentage).toBe(75);
        expect(wallet?.maxTradeSize).toBe(200);
        expect(wallet?.dailyLimit).toBe(1000);
      });
    });

    describe("deleteTradingWallet", () => {
      test("should delete trading wallet", () => {
        copyService.saveTradingWallet(TEST_USER_ID, "0xmywallet", "creds");
        const result = copyService.deleteTradingWallet(TEST_USER_ID);

        expect(result).toBe(true);

        const wallet = copyService.getTradingWallet(TEST_USER_ID);
        expect(wallet).toBeNull();
      });

      test("should return true even if no wallet exists", () => {
        const result = copyService.deleteTradingWallet(TEST_USER_ID);
        expect(result).toBe(true);
      });
    });
  });

  describe("Copy Trade History", () => {
    describe("logCopyTrade", () => {
      test("should log a copy trade record", () => {
        const recordId = copyService.logCopyTrade({
          userId: TEST_USER_ID,
          sourceWallet: "0xwhale",
          sourceTradeHash: "0xtxhash",
          marketConditionId: "condition-123",
          marketTitle: "Test Market",
          side: "BUY",
          size: 100,
          price: 0.5,
          status: "executed",
          orderId: "order-123",
          txHash: "0xresulttx",
          errorMessage: null,
        });

        expect(recordId).toBeGreaterThan(0);
      });

      test("should log failed trades with error message", () => {
        const recordId = copyService.logCopyTrade({
          userId: TEST_USER_ID,
          sourceWallet: "0xwhale",
          sourceTradeHash: "0xtxhash",
          marketConditionId: "condition-123",
          marketTitle: "Test Market",
          side: "BUY",
          size: 100,
          price: 0.5,
          status: "failed",
          orderId: null,
          txHash: null,
          errorMessage: "Insufficient funds",
        });

        expect(recordId).toBeGreaterThan(0);

        const history = copyService.getCopyTradeHistory(TEST_USER_ID);
        expect(history[0]!.status).toBe("failed");
        expect(history[0]!.errorMessage).toBe("Insufficient funds");
      });
    });

    describe("getCopyTradeHistory", () => {
      test("should return empty array for user with no history", () => {
        const history = copyService.getCopyTradeHistory(TEST_USER_ID);
        expect(history).toBeInstanceOf(Array);
        expect(history.length).toBe(0);
      });

      test("should return trades ordered by id descending (most recent first)", () => {
        const id1 = copyService.logCopyTrade({
          userId: TEST_USER_ID,
          sourceWallet: "0xwhale",
          sourceTradeHash: "0xtx1",
          marketConditionId: "cond-1",
          marketTitle: "Market 1",
          side: "BUY",
          size: 100,
          price: 0.5,
          status: "executed",
          orderId: null,
          txHash: null,
          errorMessage: null,
        });

        const id2 = copyService.logCopyTrade({
          userId: TEST_USER_ID,
          sourceWallet: "0xwhale",
          sourceTradeHash: "0xtx2",
          marketConditionId: "cond-2",
          marketTitle: "Market 2",
          side: "SELL",
          size: 50,
          price: 0.75,
          status: "executed",
          orderId: null,
          txHash: null,
          errorMessage: null,
        });

        const history = copyService.getCopyTradeHistory(TEST_USER_ID);
        expect(history.length).toBe(2);
        // The second insert has higher id, so it should be first when sorted DESC
        // Verify proper ordering by checking relative positions
        expect(id2).toBeGreaterThan(id1);
        expect(history[0]!.id).toBeGreaterThan(history[1]!.id);
      });

      test("should respect limit parameter", () => {
        for (let i = 0; i < 5; i++) {
          copyService.logCopyTrade({
            userId: TEST_USER_ID,
            sourceWallet: "0xwhale",
            sourceTradeHash: `0xtx${i}`,
            marketConditionId: `cond-${i}`,
            marketTitle: `Market ${i}`,
            side: "BUY",
            size: 100,
            price: 0.5,
            status: "executed",
            orderId: null,
            txHash: null,
            errorMessage: null,
          });
        }

        const history = copyService.getCopyTradeHistory(TEST_USER_ID, 3);
        expect(history.length).toBe(3);
      });
    });

    describe("getTodaysCopyTotal", () => {
      test("should return 0 for user with no trades today", () => {
        const total = copyService.getTodaysCopyTotal(TEST_USER_ID);
        expect(total).toBe(0);
      });

      test("should sum only executed trades", () => {
        // Executed trade: $50 (must have txHash to count)
        copyService.logCopyTrade({
          userId: TEST_USER_ID,
          sourceWallet: "0xwhale",
          sourceTradeHash: "0xtx1",
          marketConditionId: "cond-1",
          marketTitle: "Market 1",
          side: "BUY",
          size: 50,
          price: 0.5,
          status: "executed",
          orderId: "order-123",
          txHash: "0xtxhash123", // Must have txHash to be counted
          errorMessage: null,
        });

        // Failed trade should not count
        copyService.logCopyTrade({
          userId: TEST_USER_ID,
          sourceWallet: "0xwhale",
          sourceTradeHash: "0xtx2",
          marketConditionId: "cond-2",
          marketTitle: "Market 2",
          side: "BUY",
          size: 200,
          price: 0.5,
          status: "failed",
          orderId: null,
          txHash: null,
          errorMessage: "Failed",
        });

        const total = copyService.getTodaysCopyTotal(TEST_USER_ID);
        expect(total).toBe(50); // Only the executed trade
      });
    });

    describe("updateCopyTradeStatus", () => {
      test("should update trade status from pending to executed", () => {
        const recordId = copyService.logCopyTrade({
          userId: TEST_USER_ID,
          sourceWallet: "0xwhale",
          sourceTradeHash: "0xtx1",
          marketConditionId: "cond-1",
          marketTitle: "Market 1",
          side: "BUY",
          size: 100,
          price: 0.5,
          status: "pending",
          orderId: null,
          txHash: null,
          errorMessage: null,
        });

        copyService.updateCopyTradeStatus(recordId, "executed", "order-123", "0xresulttx");

        const history = copyService.getCopyTradeHistory(TEST_USER_ID);
        expect(history[0]!.status).toBe("executed");
        expect(history[0]!.orderId).toBe("order-123");
        expect(history[0]!.txHash).toBe("0xresulttx");
      });

      test("should update trade status to failed with error", () => {
        const recordId = copyService.logCopyTrade({
          userId: TEST_USER_ID,
          sourceWallet: "0xwhale",
          sourceTradeHash: "0xtx1",
          marketConditionId: "cond-1",
          marketTitle: "Market 1",
          side: "BUY",
          size: 100,
          price: 0.5,
          status: "pending",
          orderId: null,
          txHash: null,
          errorMessage: null,
        });

        copyService.updateCopyTradeStatus(recordId, "failed", undefined, undefined, "Order rejected");

        const history = copyService.getCopyTradeHistory(TEST_USER_ID);
        expect(history[0]!.status).toBe("failed");
        expect(history[0]!.errorMessage).toBe("Order rejected");
      });
    });
  });

  describe("generateCopyLink", () => {
    test("should generate Polymarket link from trade", () => {
      const trade = {
        slug: "presidential-election-2024",
      } as any;

      const link = copyService.generateCopyLink(trade);
      expect(link).toBe("https://polymarket.com/event/presidential-election-2024");
    });
  });
});
