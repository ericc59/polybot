import { test, expect, describe, beforeEach, afterEach, beforeAll, mock } from "bun:test";
import { db, getDb } from "../db/index";
import * as paperService from "../services/paper.service";
import type { Trade } from "../api/polymarket";

// Test user ID
const TEST_USER_ID = 99999;

describe("paper.service", () => {
  beforeAll(async () => {
    // Initialize database before all tests
    await getDb();
  });

  beforeEach(() => {
    // Initialize tables
    paperService.initPaperTables();

    // Clean up any existing test data
    try {
      db().exec(`DELETE FROM paper_trades WHERE portfolio_id IN (SELECT id FROM paper_portfolios WHERE user_id = ${TEST_USER_ID})`);
      db().exec(`DELETE FROM paper_positions WHERE portfolio_id IN (SELECT id FROM paper_portfolios WHERE user_id = ${TEST_USER_ID})`);
      db().exec(`DELETE FROM paper_portfolio_wallets WHERE portfolio_id IN (SELECT id FROM paper_portfolios WHERE user_id = ${TEST_USER_ID})`);
      db().exec(`DELETE FROM paper_snapshots WHERE portfolio_id IN (SELECT id FROM paper_portfolios WHERE user_id = ${TEST_USER_ID})`);
      db().exec(`DELETE FROM paper_portfolios WHERE user_id = ${TEST_USER_ID}`);
    } catch (e) {
      // Tables might not exist yet
    }
  });

  afterEach(() => {
    // Clean up test data
    try {
      db().exec(`DELETE FROM paper_trades WHERE portfolio_id IN (SELECT id FROM paper_portfolios WHERE user_id = ${TEST_USER_ID})`);
      db().exec(`DELETE FROM paper_positions WHERE portfolio_id IN (SELECT id FROM paper_portfolios WHERE user_id = ${TEST_USER_ID})`);
      db().exec(`DELETE FROM paper_portfolio_wallets WHERE portfolio_id IN (SELECT id FROM paper_portfolios WHERE user_id = ${TEST_USER_ID})`);
      db().exec(`DELETE FROM paper_snapshots WHERE portfolio_id IN (SELECT id FROM paper_portfolios WHERE user_id = ${TEST_USER_ID})`);
      db().exec(`DELETE FROM paper_portfolios WHERE user_id = ${TEST_USER_ID}`);
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe("startPaperTrading", () => {
    test("should create a new portfolio with starting balance", () => {
      const result = paperService.startPaperTrading(TEST_USER_ID, 1000);

      expect(result.success).toBe(true);
      expect(result.portfolioId).toBeDefined();

      const portfolio = paperService.getPaperPortfolio(TEST_USER_ID);
      expect(portfolio).not.toBeNull();
      expect(portfolio?.startingBalance).toBe(1000);
      expect(portfolio?.currentCash).toBe(1000);
    });

    test("should not allow duplicate portfolios", () => {
      paperService.startPaperTrading(TEST_USER_ID, 1000);
      const result = paperService.startPaperTrading(TEST_USER_ID, 2000);

      expect(result.success).toBe(false);
      expect(result.error).toContain("already have an active");
    });
  });

  describe("addWalletToPortfolio", () => {
    test("should add wallet to portfolio", () => {
      paperService.startPaperTrading(TEST_USER_ID, 1000);
      const result = paperService.addWalletToPortfolio(TEST_USER_ID, "0x1234567890abcdef");

      expect(result.success).toBe(true);

      const wallets = paperService.getTrackedWallets(TEST_USER_ID);
      expect(wallets).toContain("0x1234567890abcdef");
    });

    test("should not allow duplicate wallets", () => {
      paperService.startPaperTrading(TEST_USER_ID, 1000);
      paperService.addWalletToPortfolio(TEST_USER_ID, "0x1234");
      const result = paperService.addWalletToPortfolio(TEST_USER_ID, "0x1234");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Already tracking");
    });

    test("should normalize wallet addresses to lowercase", () => {
      paperService.startPaperTrading(TEST_USER_ID, 1000);
      paperService.addWalletToPortfolio(TEST_USER_ID, "0xABCDEF");

      const wallets = paperService.getTrackedWallets(TEST_USER_ID);
      expect(wallets).toContain("0xabcdef");
    });
  });

  describe("processPaperTrade", () => {
    const mockTrade: Trade = {
      id: "test-123",
      taker: "0xwhale",
      maker: "0xmaker",
      side: "BUY",
      asset: "asset-123",
      conditionId: "condition-123",
      size: "100",
      price: "0.50",
      timestamp: Date.now(),
      transactionHash: "0xtx123",
      title: "Test Market",
      slug: "test-market",
      outcome: "Yes",
      outcomeIndex: 0,
    };

    beforeEach(() => {
      paperService.startPaperTrading(TEST_USER_ID, 1000);
      paperService.addWalletToPortfolio(TEST_USER_ID, "0xwhale");
    });

    test("should execute BUY trade and deduct cash", async () => {
      const result = await paperService.processPaperTrade(
        TEST_USER_ID,
        "0xwhale",
        mockTrade,
        100
      );

      expect(result.success).toBe(true);

      const portfolio = paperService.getPaperPortfolio(TEST_USER_ID);
      // BUY: 100 shares * $0.50 = $50 deducted
      expect(portfolio?.currentCash).toBe(950);
      expect(portfolio?.positions.length).toBe(1);
      expect(portfolio?.positions[0]!.shares).toBe(100);
    });

    test("should reject BUY when insufficient funds", async () => {
      const bigTrade = { ...mockTrade, size: "10000", price: "0.50" }; // $5000 trade
      const result = await paperService.processPaperTrade(
        TEST_USER_ID,
        "0xwhale",
        bigTrade,
        100
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Insufficient");
    });

    test("should execute SELL trade and add cash", async () => {
      // First buy some shares
      await paperService.processPaperTrade(TEST_USER_ID, "0xwhale", mockTrade, 100);

      // Then sell
      const sellTrade = { ...mockTrade, side: "SELL" as const };
      const result = await paperService.processPaperTrade(
        TEST_USER_ID,
        "0xwhale",
        sellTrade,
        100
      );

      expect(result.success).toBe(true);

      const portfolio = paperService.getPaperPortfolio(TEST_USER_ID);
      // Should be back to ~$1000 (minus/plus any price differences)
      expect(portfolio?.currentCash).toBe(1000);
      expect(portfolio?.positions.length).toBe(0);
    });

    test("should sell only what we have when whale sells more", async () => {
      // Buy 50 shares (half of whale's 100)
      await paperService.processPaperTrade(TEST_USER_ID, "0xwhale", mockTrade, 50);

      const portfolioBefore = paperService.getPaperPortfolio(TEST_USER_ID);
      expect(portfolioBefore?.positions[0]!.shares).toBe(50);

      // Whale sells 100 shares, but we only have 50
      const sellTrade = { ...mockTrade, side: "SELL" as const, size: "100" };
      const result = await paperService.processPaperTrade(
        TEST_USER_ID,
        "0xwhale",
        sellTrade,
        100 // Try to sell 100% of whale's trade
      );

      expect(result.success).toBe(true);
      // Should have sold only 50 shares (what we had)
      expect(result.trade?.shares).toBe(50);

      const portfolioAfter = paperService.getPaperPortfolio(TEST_USER_ID);
      expect(portfolioAfter?.positions.length).toBe(0);
    });

    test("should fail SELL when no position exists", async () => {
      const sellTrade = { ...mockTrade, side: "SELL" as const };
      const result = await paperService.processPaperTrade(
        TEST_USER_ID,
        "0xwhale",
        sellTrade,
        100
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("No position");
    });

    test("should apply copy percentage correctly", async () => {
      const result = await paperService.processPaperTrade(
        TEST_USER_ID,
        "0xwhale",
        mockTrade,
        50 // Copy only 50%
      );

      expect(result.success).toBe(true);

      const portfolio = paperService.getPaperPortfolio(TEST_USER_ID);
      // 50% of 100 shares = 50 shares, 50 * $0.50 = $25 deducted
      expect(portfolio?.currentCash).toBe(975);
      expect(portfolio?.positions[0]!.shares).toBe(50);
    });

    test("should accumulate position on multiple buys", async () => {
      await paperService.processPaperTrade(TEST_USER_ID, "0xwhale", mockTrade, 100);
      await paperService.processPaperTrade(TEST_USER_ID, "0xwhale", mockTrade, 100);

      const portfolio = paperService.getPaperPortfolio(TEST_USER_ID);
      expect(portfolio?.positions.length).toBe(1);
      expect(portfolio?.positions[0]!.shares).toBe(200);
    });
  });

  describe("getPaperPortfolio", () => {
    test("should calculate P&L correctly", async () => {
      paperService.startPaperTrading(TEST_USER_ID, 1000);
      paperService.addWalletToPortfolio(TEST_USER_ID, "0xwhale");

      const trade: Trade = {
        id: "test-123",
        taker: "0xwhale",
        maker: "0xmaker",
        side: "BUY",
        asset: "asset-123",
        conditionId: "condition-123",
        size: "100",
        price: "0.50",
        timestamp: Date.now(),
        transactionHash: "0xtx123",
        title: "Test Market",
        slug: "test-market",
        outcome: "Yes",
        outcomeIndex: 0,
      };

      await paperService.processPaperTrade(TEST_USER_ID, "0xwhale", trade, 100);

      const portfolio = paperService.getPaperPortfolio(TEST_USER_ID);

      // $950 cash + 100 shares * $0.50 (using avg price as current) = $1000
      expect(portfolio?.totalValue).toBeCloseTo(1000, 0);
      expect(portfolio?.pnl).toBeCloseTo(0, 0);
    });

    test("should return null for non-existent user", () => {
      const portfolio = paperService.getPaperPortfolio(12345678);
      expect(portfolio).toBeNull();
    });
  });

  describe("stopPaperTrading", () => {
    test("should deactivate portfolio", () => {
      paperService.startPaperTrading(TEST_USER_ID, 1000);

      const result = paperService.stopPaperTrading(TEST_USER_ID);
      expect(result.success).toBe(true);
      expect(result.portfolio).toBeDefined();

      // Portfolio should no longer be accessible
      const portfolio = paperService.getPaperPortfolio(TEST_USER_ID);
      expect(portfolio).toBeNull();
    });
  });

  describe("getPaperSubscribers", () => {
    test("should return users tracking a wallet", () => {
      paperService.startPaperTrading(TEST_USER_ID, 1000);
      paperService.addWalletToPortfolio(TEST_USER_ID, "0xwhale123");

      const subscribers = paperService.getPaperSubscribers("0xwhale123");
      expect(subscribers.length).toBe(1);
      expect(subscribers[0]!.userId).toBe(TEST_USER_ID);
    });

    test("should return empty array for untracked wallet", () => {
      const subscribers = paperService.getPaperSubscribers("0xunknown");
      expect(subscribers.length).toBe(0);
    });
  });
});
