import type { ClobClient } from "@polymarket/clob-client";
import { tennisConfig, DRY_RUN } from "../config";
import { db } from "../db";
import { logger } from "../../lib/logger";
import {
  createClobClient,
  deriveApiKey,
  isValidPrivateKey,
  getAddressFromPrivateKey,
} from "../../lib/trading/client";
import { getBalance } from "../../lib/trading/balance";
import { placeLimitOrder, getOpenOrders, cancelAllOrders, getOrderBook, placeSweepOrder } from "../../lib/trading/orders";
import { encryptCredentials, decryptCredentials } from "../../lib/crypto";
import type { TrackedMatch, TennisWallet, PlacedOrder } from "../types";
import type { TradeResult } from "../../lib/trading/types";
import { getAllMarketsForEvent, getAllMarketsForMatch, type MarketForOrders } from "./market-finder.service";

// Module state
let clobClient: ClobClient | null = null;
let walletAddress: string | null = null;
let proxyAddress: string | null = null;

/**
 * Initialize the trading client with stored credentials
 */
export async function init(): Promise<boolean> {
  const wallet = getTradingWallet();

  if (!wallet) {
    logger.warn("No trading wallet configured");
    return false;
  }

  try {
    const creds = decryptCredentials(wallet.encryptedCredentials);

    if (!creds.privateKey) {
      logger.error("Trading wallet missing private key");
      return false;
    }

    // Check for missing API credentials
    if (!creds.apiKey || !creds.apiSecret || !creds.passphrase) {
      logger.warn("Wallet missing API credentials, deriving them...");
      const derived = await deriveApiKey(creds.privateKey);
      if (derived) {
        creds.apiKey = derived.apiKey;
        creds.apiSecret = derived.apiSecret;
        creds.passphrase = derived.passphrase;

        // Update stored credentials
        const encrypted = encryptCredentials(creds);
        db().prepare(`
          UPDATE trading_wallet SET encrypted_credentials = ? WHERE id = 1
        `).run(encrypted);
        logger.success("API credentials derived and saved");
      } else {
        logger.error("Failed to derive API credentials");
        return false;
      }
    }

    clobClient = await createClobClient(
      creds.privateKey,
      { apiKey: creds.apiKey, apiSecret: creds.apiSecret, passphrase: creds.passphrase },
      wallet.proxyAddress || undefined
    );

    walletAddress = wallet.walletAddress;
    proxyAddress = wallet.proxyAddress;

    logger.success(`Trading client initialized for wallet ${walletAddress.slice(0, 10)}...`);
    return true;
  } catch (error) {
    logger.error("Failed to initialize trading client", error);
    return false;
  }
}

/**
 * Connect a new trading wallet
 */
export async function connectWallet(
  privateKey: string,
  proxy?: string
): Promise<{ success: boolean; address?: string; error?: string }> {
  if (!isValidPrivateKey(privateKey)) {
    return { success: false, error: "Invalid private key format" };
  }

  try {
    // Derive API credentials
    const creds = await deriveApiKey(privateKey);
    if (!creds) {
      return { success: false, error: "Failed to derive API credentials" };
    }

    const address = getAddressFromPrivateKey(privateKey);

    // Encrypt and store credentials
    const encrypted = encryptCredentials({
      apiKey: creds.apiKey,
      apiSecret: creds.apiSecret,
      passphrase: creds.passphrase,
      privateKey,
    });

    // Save to database (upsert)
    const stmt = db().prepare(`
      INSERT OR REPLACE INTO trading_wallet (id, wallet_address, encrypted_credentials, proxy_address, created_at)
      VALUES (1, ?, ?, ?, ?)
    `);

    stmt.run(address, encrypted, proxy || null, Math.floor(Date.now() / 1000));

    // Initialize client
    await init();

    logger.success(`Connected trading wallet: ${address}`);
    return { success: true, address };
  } catch (error: any) {
    logger.error("Failed to connect wallet", error);
    return { success: false, error: error.message || "Unknown error" };
  }
}

/**
 * Disconnect the trading wallet
 */
export function disconnectWallet(): void {
  const stmt = db().prepare("DELETE FROM trading_wallet WHERE id = 1");
  stmt.run();

  clobClient = null;
  walletAddress = null;
  proxyAddress = null;

  logger.info("Trading wallet disconnected");
}

/**
 * Get stored trading wallet
 */
export function getTradingWallet(): TennisWallet | null {
  const stmt = db().prepare(`
    SELECT id, wallet_address as walletAddress, encrypted_credentials as encryptedCredentials,
           proxy_address as proxyAddress, created_at as createdAt
    FROM trading_wallet
    WHERE id = 1
  `);

  return stmt.get() as TennisWallet | null;
}

/**
 * Check if trading is ready
 */
export function isReady(): boolean {
  if (DRY_RUN) return true; // Always ready in dry run mode
  return clobClient !== null;
}

/**
 * Get wallet balance
 */
export async function getWalletBalance(): Promise<{ balance: number; allowance: number } | null> {
  if (!clobClient) {
    return null;
  }

  try {
    return await getBalance(clobClient, proxyAddress || undefined);
  } catch (error) {
    logger.error("Failed to get wallet balance", error);
    return null;
  }
}

/**
 * Sweep order book result
 */
export interface SweepResult {
  success: boolean;
  sharesBought: number;
  costUsd: number;
  avgPrice: number;
  expectedProfit: number;
  orderId?: string;
  error?: string;
}

/**
 * Walkover sweep result
 */
export interface WalkoverSweepResult {
  success: boolean;
  player1: SweepResult;
  player2: SweepResult;
  totalCost: number;
  totalShares: number;
  totalExpectedProfit: number;
  error?: string;
}

/**
 * Analyze order book for potential walkover profit
 */
export async function analyzeWalkoverOpportunity(
  match: TrackedMatch,
  maxPrice: number = tennisConfig.BID_PRICE
): Promise<{
  player1: { shares: number; cost: number; avgPrice: number; profit: number };
  player2: { shares: number; cost: number; avgPrice: number; profit: number };
  totalCost: number;
  totalProfit: number;
} | null> {
  if (!match.player1TokenId || !match.player2TokenId) {
    return null;
  }

  if (!clobClient) {
    logger.error("Trading client not initialized");
    return null;
  }

  // Fetch order books for both players
  const [book1, book2] = await Promise.all([
    getOrderBook(clobClient, match.player1TokenId),
    getOrderBook(clobClient, match.player2TokenId),
  ]);

  if (!book1 || !book2) {
    logger.error("Failed to fetch order books");
    return null;
  }

  const p1 = book1.totalAsksUnderPrice(maxPrice);
  const p2 = book2.totalAsksUnderPrice(maxPrice);

  const p1AvgPrice = p1.shares > 0 ? p1.cost / p1.shares : 0;
  const p2AvgPrice = p2.shares > 0 ? p2.cost / p2.shares : 0;

  // Profit = (shares * $0.50) - cost
  const p1Profit = p1.shares * 0.5 - p1.cost;
  const p2Profit = p2.shares * 0.5 - p2.cost;

  return {
    player1: { shares: p1.shares, cost: p1.cost, avgPrice: p1AvgPrice, profit: p1Profit },
    player2: { shares: p2.shares, cost: p2.cost, avgPrice: p2AvgPrice, profit: p2Profit },
    totalCost: p1.cost + p2.cost,
    totalProfit: p1Profit + p2Profit,
  };
}

/**
 * Sweep order book on walkover detection
 * Buys all shares available under $0.49 on BOTH players
 * Since walkover settles at $0.50 each, any share under $0.50 is profit
 */
export async function sweepWalkoverOrders(
  match: TrackedMatch,
  maxPrice: number = tennisConfig.BID_PRICE,
  maxSpendPerSide?: number
): Promise<WalkoverSweepResult> {
  // SAFETY: Never place walkover orders after match has started
  const now = Math.floor(Date.now() / 1000);
  if (now > match.commenceTime) {
    const minutesAgo = Math.floor((now - match.commenceTime) / 60);
    logger.error(`BLOCKED: Cannot place walkover orders - match started ${minutesAgo}m ago`);
    return {
      success: false,
      player1: { success: false, sharesBought: 0, costUsd: 0, avgPrice: 0, expectedProfit: 0, error: "Match already started" },
      player2: { success: false, sharesBought: 0, costUsd: 0, avgPrice: 0, expectedProfit: 0, error: "Match already started" },
      totalCost: 0,
      totalShares: 0,
      totalExpectedProfit: 0,
      error: `Match already started ${minutesAgo}m ago. Walkovers only happen before match start.`,
    };
  }

  if (!match.player1TokenId || !match.player2TokenId) {
    return {
      success: false,
      player1: { success: false, sharesBought: 0, costUsd: 0, avgPrice: 0, expectedProfit: 0, error: "Missing token ID" },
      player2: { success: false, sharesBought: 0, costUsd: 0, avgPrice: 0, expectedProfit: 0, error: "Missing token ID" },
      totalCost: 0,
      totalShares: 0,
      totalExpectedProfit: 0,
      error: "Match missing token IDs",
    };
  }

  // DRY RUN MODE - analyze what would be bought
  if (DRY_RUN) {
    logger.warn(`[DRY RUN] 🚨 WALKOVER DETECTED: ${match.player1} vs ${match.player2}`);
    logger.warn(`[DRY RUN] Analyzing order book for sweep...`);

    // Still analyze the order book in dry run mode
    if (clobClient) {
      const analysis = await analyzeWalkoverOpportunity(match, maxPrice);
      if (analysis) {
        logger.warn(`[DRY RUN] 📊 ${match.player1}: ${analysis.player1.shares.toFixed(0)} shares @ avg $${analysis.player1.avgPrice.toFixed(3)} = $${analysis.player1.cost.toFixed(2)} → profit $${analysis.player1.profit.toFixed(2)}`);
        logger.warn(`[DRY RUN] 📊 ${match.player2}: ${analysis.player2.shares.toFixed(0)} shares @ avg $${analysis.player2.avgPrice.toFixed(3)} = $${analysis.player2.cost.toFixed(2)} → profit $${analysis.player2.profit.toFixed(2)}`);
        logger.warn(`[DRY RUN] 💰 TOTAL: $${analysis.totalCost.toFixed(2)} cost → $${analysis.totalProfit.toFixed(2)} expected profit`);

        return {
          success: true,
          player1: { success: true, sharesBought: analysis.player1.shares, costUsd: analysis.player1.cost, avgPrice: analysis.player1.avgPrice, expectedProfit: analysis.player1.profit, orderId: "DRY_RUN" },
          player2: { success: true, sharesBought: analysis.player2.shares, costUsd: analysis.player2.cost, avgPrice: analysis.player2.avgPrice, expectedProfit: analysis.player2.profit, orderId: "DRY_RUN" },
          totalCost: analysis.totalCost,
          totalShares: analysis.player1.shares + analysis.player2.shares,
          totalExpectedProfit: analysis.totalProfit,
        };
      }
    }

    return {
      success: true,
      player1: { success: true, sharesBought: 0, costUsd: 0, avgPrice: 0, expectedProfit: 0, orderId: "DRY_RUN" },
      player2: { success: true, sharesBought: 0, costUsd: 0, avgPrice: 0, expectedProfit: 0, orderId: "DRY_RUN" },
      totalCost: 0,
      totalShares: 0,
      totalExpectedProfit: 0,
    };
  }

  if (!clobClient) {
    return {
      success: false,
      player1: { success: false, sharesBought: 0, costUsd: 0, avgPrice: 0, expectedProfit: 0, error: "Not initialized" },
      player2: { success: false, sharesBought: 0, costUsd: 0, avgPrice: 0, expectedProfit: 0, error: "Not initialized" },
      totalCost: 0,
      totalShares: 0,
      totalExpectedProfit: 0,
      error: "Trading client not initialized",
    };
  }

  // Check balance
  const balanceResult = await getWalletBalance();
  if (!balanceResult) {
    return {
      success: false,
      player1: { success: false, sharesBought: 0, costUsd: 0, avgPrice: 0, expectedProfit: 0, error: "Balance check failed" },
      player2: { success: false, sharesBought: 0, costUsd: 0, avgPrice: 0, expectedProfit: 0, error: "Balance check failed" },
      totalCost: 0,
      totalShares: 0,
      totalExpectedProfit: 0,
      error: "Failed to check balance",
    };
  }

  const availableBalance = balanceResult.balance;
  // Use 50% of balance total (25% per side) if no max specified
  const maxPerSide = maxSpendPerSide || (availableBalance * 0.5) / 2;

  logger.info(`🚨 WALKOVER SWEEP: ${match.player1} vs ${match.player2}`);
  logger.info(`💰 Available balance: $${availableBalance.toFixed(2)}, max per side: $${maxPerSide.toFixed(2)}`);

  // Sweep both order books in parallel
  const [sweep1, sweep2] = await Promise.all([
    placeSweepOrder(clobClient, {
      tokenId: match.player1TokenId,
      maxPrice,
      maxSpend: maxPerSide,
    }),
    placeSweepOrder(clobClient, {
      tokenId: match.player2TokenId,
      maxPrice,
      maxSpend: maxPerSide,
    }),
  ]);

  // Calculate results
  const p1Shares = sweep1.sharesBought || 0;
  const p2Shares = sweep2.sharesBought || 0;
  const p1Cost = p1Shares * (sweep1.avgPrice || maxPrice);
  const p2Cost = p2Shares * (sweep2.avgPrice || maxPrice);
  const p1Profit = p1Shares * 0.5 - p1Cost;
  const p2Profit = p2Shares * 0.5 - p2Cost;

  const player1Result: SweepResult = {
    success: sweep1.success,
    sharesBought: p1Shares,
    costUsd: p1Cost,
    avgPrice: sweep1.avgPrice || 0,
    expectedProfit: p1Profit,
    orderId: sweep1.orderId,
    error: sweep1.error,
  };

  const player2Result: SweepResult = {
    success: sweep2.success,
    sharesBought: p2Shares,
    costUsd: p2Cost,
    avgPrice: sweep2.avgPrice || 0,
    expectedProfit: p2Profit,
    orderId: sweep2.orderId,
    error: sweep2.error,
  };

  // Record orders in database
  if (sweep1.success && sweep1.orderId) {
    recordPlacedOrder(match.id, match.player1, match.player1TokenId, sweep1.orderId, p1Shares, sweep1.avgPrice);
  }
  if (sweep2.success && sweep2.orderId) {
    recordPlacedOrder(match.id, match.player2, match.player2TokenId, sweep2.orderId, p2Shares, sweep2.avgPrice);
  }

  // Update match status
  if (sweep1.success || sweep2.success) {
    markOrdersPlaced(match.id);
  }

  const success = sweep1.success || sweep2.success;
  const totalCost = p1Cost + p2Cost;
  const totalShares = p1Shares + p2Shares;
  const totalProfit = p1Profit + p2Profit;

  if (success) {
    logger.success(`✅ SWEEP COMPLETE:`);
    logger.success(`   ${match.player1}: ${p1Shares.toFixed(0)} shares @ $${(sweep1.avgPrice || 0).toFixed(3)} = $${p1Cost.toFixed(2)}`);
    logger.success(`   ${match.player2}: ${p2Shares.toFixed(0)} shares @ $${(sweep2.avgPrice || 0).toFixed(3)} = $${p2Cost.toFixed(2)}`);
    logger.success(`   💰 Total: ${totalShares.toFixed(0)} shares, $${totalCost.toFixed(2)} cost, $${totalProfit.toFixed(2)} expected profit`);
  } else {
    logger.error(`❌ SWEEP FAILED: P1=${sweep1.error}, P2=${sweep2.error}`);
  }

  return {
    success,
    player1: player1Result,
    player2: player2Result,
    totalCost,
    totalShares,
    totalExpectedProfit: totalProfit,
  };
}

/**
 * Result from placing orders on all markets
 */
export interface AllMarketsOrderResult {
  success: boolean;
  marketsOrdered: number;
  totalOrders: number;
  totalOrdersPlaced: number;
  orderResults: Array<{
    market: string;
    conditionId: string;
    outcome: string;
    tokenId: string;
    orderId?: string;
    success: boolean;
    error?: string;
  }>;
  error?: string;
}

/**
 * Place $0.49 limit orders on ALL outcomes of ALL markets for an event
 * On walkover, every market settles at $0.50 per outcome, so any order under $0.50 profits
 */
export async function placeAllMarketWalkoverOrders(
  match: TrackedMatch,
  bidPrice: number = tennisConfig.BID_PRICE
): Promise<AllMarketsOrderResult> {
  // SAFETY: Never place walkover orders after match has started
  const now = Math.floor(Date.now() / 1000);
  if (now > match.commenceTime) {
    const minutesAgo = Math.floor((now - match.commenceTime) / 60);
    logger.error(`BLOCKED: Cannot place walkover orders - match started ${minutesAgo}m ago`);
    return {
      success: false,
      marketsOrdered: 0,
      totalOrders: 0,
      totalOrdersPlaced: 0,
      orderResults: [],
      error: `Match already started ${minutesAgo}m ago. Walkovers only happen before match start.`,
    };
  }

  // Get all markets for this event
  let markets: MarketForOrders[] = [];

  if (match.polymarketSlug) {
    // Use slug if available
    markets = await getAllMarketsForEvent(match.polymarketSlug);
  } else {
    // Fall back to finding by player names
    const result = await getAllMarketsForMatch(match.player1, match.player2);
    if (result) {
      markets = result.markets;
      // Store the slug for future use
      if (result.slug) {
        db().prepare("UPDATE tracked_matches SET polymarket_slug = ? WHERE id = ?").run(result.slug, match.id);
      }
    }
  }

  if (markets.length === 0) {
    return {
      success: false,
      marketsOrdered: 0,
      totalOrders: 0,
      totalOrdersPlaced: 0,
      orderResults: [],
      error: "No markets found for this event",
    };
  }

  // DRY RUN MODE - still check liquidity for realistic estimates
  if (DRY_RUN) {
    logger.warn(`[DRY RUN] 🚨 WALKOVER DETECTED: ${match.player1} vs ${match.player2}`);
    logger.warn(`[DRY RUN] Checking liquidity across ${markets.length} markets...`);

    let liquidCount = 0;
    const dryRunResults: AllMarketsOrderResult["orderResults"] = [];

    if (clobClient) {
      for (const market of markets) {
        for (const outcome of market.outcomes) {
          try {
            const orderBook = await getOrderBook(clobClient, outcome.tokenId);
            if (orderBook) {
              const available = orderBook.totalAsksUnderPrice(bidPrice);
              if (available.cost >= 1) {
                liquidCount++;
                logger.warn(`[DRY RUN]   ✅ ${market.question} - ${outcome.outcome}: ${available.shares.toFixed(0)} shares ($${available.cost.toFixed(2)})`);
                dryRunResults.push({
                  market: market.question,
                  conditionId: market.conditionId,
                  outcome: outcome.outcome,
                  tokenId: outcome.tokenId,
                  orderId: "DRY_RUN",
                  success: true,
                });
              } else {
                logger.warn(`[DRY RUN]   ⏭️ ${market.question} - ${outcome.outcome}: skipping (only $${available.cost.toFixed(2)} liquidity)`);
              }
            }
            await Bun.sleep(50);
          } catch {
            logger.warn(`[DRY RUN]   ❌ ${market.question} - ${outcome.outcome}: failed to check`);
          }
        }
      }
    }

    logger.warn(`[DRY RUN] Would place orders on ${liquidCount} liquid outcomes`);
    return {
      success: true,
      marketsOrdered: markets.length,
      totalOrders: liquidCount,
      totalOrdersPlaced: 0,
      orderResults: dryRunResults,
    };
  }

  if (!clobClient) {
    return {
      success: false,
      marketsOrdered: 0,
      totalOrders: 0,
      totalOrdersPlaced: 0,
      orderResults: [],
      error: "Trading client not initialized",
    };
  }

  // Check balance
  const balanceResult = await getWalletBalance();
  if (!balanceResult) {
    return {
      success: false,
      marketsOrdered: 0,
      totalOrders: 0,
      totalOrdersPlaced: 0,
      orderResults: [],
      error: "Failed to check balance",
    };
  }

  const availableBalance = balanceResult.balance;
  const totalBudget = availableBalance * 0.5; // Use 50% of balance

  logger.info(`🚨 WALKOVER - CHECKING LIQUIDITY ON ALL MARKETS`);
  logger.info(`💰 Balance: $${availableBalance.toFixed(2)}, Budget: $${totalBudget.toFixed(2)}`);

  // Step 1: Check liquidity for all outcomes
  interface OutcomeWithLiquidity {
    market: MarketForOrders;
    outcome: { outcome: string; tokenId: string };
    liquidityShares: number;
    liquidityCost: number;
  }

  const liquidOutcomes: OutcomeWithLiquidity[] = [];
  const minLiquidityUsd = 1; // Skip outcomes with less than $1 liquidity

  for (const market of markets) {
    for (const outcome of market.outcomes) {
      try {
        const orderBook = await getOrderBook(clobClient, outcome.tokenId);
        if (orderBook) {
          const available = orderBook.totalAsksUnderPrice(bidPrice);
          if (available.cost >= minLiquidityUsd) {
            liquidOutcomes.push({
              market,
              outcome,
              liquidityShares: available.shares,
              liquidityCost: available.cost,
            });
            logger.info(`  ✅ ${market.question} - ${outcome.outcome}: ${available.shares.toFixed(0)} shares ($${available.cost.toFixed(2)}) available`);
          } else {
            logger.info(`  ⏭️ ${market.question} - ${outcome.outcome}: skipping (only $${available.cost.toFixed(2)} liquidity)`);
          }
        }
        await Bun.sleep(50); // Small delay between order book queries
      } catch (error) {
        logger.warn(`  ❌ ${market.question} - ${outcome.outcome}: failed to check liquidity`);
      }
    }
  }

  if (liquidOutcomes.length === 0) {
    return {
      success: false,
      marketsOrdered: 0,
      totalOrders: 0,
      totalOrdersPlaced: 0,
      orderResults: [],
      error: "No markets have sufficient liquidity at the bid price",
    };
  }

  // Step 2: Calculate budget per liquid outcome
  const budgetPerOutcome = totalBudget / liquidOutcomes.length;

  logger.info(`📊 Found ${liquidOutcomes.length} liquid outcomes, $${budgetPerOutcome.toFixed(2)} budget each`);

  const orderResults: AllMarketsOrderResult["orderResults"] = [];
  let successCount = 0;
  const marketsWithOrders = new Set<string>();

  // Step 3: Place orders only on liquid outcomes
  for (const { market, outcome, liquidityShares, liquidityCost } of liquidOutcomes) {
    try {
      // Size is min of: budget allows, or available liquidity
      const maxSharesFromBudget = Math.floor(budgetPerOutcome / bidPrice);
      const sizeToOrder = Math.min(maxSharesFromBudget, Math.floor(liquidityShares));

      if (sizeToOrder < 2) {
        logger.warn(`    ⏭️ ${outcome.outcome}: skipping (size too small: ${sizeToOrder})`);
        continue;
      }

      const result = await placeLimitOrder(clobClient, {
        tokenId: outcome.tokenId,
        side: "BUY",
        price: bidPrice,
        size: sizeToOrder,
      });

      if (result.success) {
        successCount++;
        marketsWithOrders.add(market.conditionId);
        logger.success(`    ✅ ${outcome.outcome}: ${sizeToOrder} shares @ $${bidPrice}`);

        // Record in database
        recordPlacedOrderForMarket(
          match.id,
          market.conditionId,
          market.question,
          outcome.outcome,
          outcome.tokenId,
          result.orderId || "",
          sizeToOrder,
          bidPrice
        );
      } else {
        logger.warn(`    ❌ ${outcome.outcome}: ${result.error}`);
      }

      orderResults.push({
        market: market.question,
        conditionId: market.conditionId,
        outcome: outcome.outcome,
        tokenId: outcome.tokenId,
        orderId: result.orderId,
        success: result.success,
        error: result.error,
      });

      // Small delay between orders to avoid rate limiting
      await Bun.sleep(100);
    } catch (error: any) {
      logger.error(`    ❌ ${outcome.outcome}: ${error.message}`);
      orderResults.push({
        market: market.question,
        conditionId: market.conditionId,
        outcome: outcome.outcome,
        tokenId: outcome.tokenId,
        success: false,
        error: error.message,
      });
    }
  }

  // Update match status if any orders were placed
  if (successCount > 0) {
    markOrdersPlaced(match.id);
  }

  const success = successCount > 0;
  const totalOutcomes = markets.reduce((sum, m) => sum + m.outcomes.length, 0);
  logger.info(`📊 WALKOVER ORDERS COMPLETE: ${successCount}/${liquidOutcomes.length} liquid outcomes (${totalOutcomes} total) across ${marketsWithOrders.size}/${markets.length} markets`);

  return {
    success,
    marketsOrdered: marketsWithOrders.size,
    totalOrders: liquidOutcomes.length,
    totalOrdersPlaced: successCount,
    orderResults,
    error: success ? undefined : "No orders were placed",
  };
}

/**
 * Record a placed order in the database (with market info)
 */
function recordPlacedOrderForMarket(
  matchId: number,
  conditionId: string,
  marketQuestion: string,
  outcome: string,
  tokenId: string,
  orderId: string,
  size: number,
  price: number
): void {
  // Include 'player' for backwards compatibility with old database schemas that have player NOT NULL
  const stmt = db().prepare(`
    INSERT INTO placed_orders (match_id, condition_id, market_question, outcome, player, token_id, order_id, side, price, size, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'BUY', ?, ?, 'pending', ?)
  `);

  stmt.run(matchId, conditionId, marketQuestion, outcome, outcome, tokenId, orderId, price, size, Math.floor(Date.now() / 1000));
}

/**
 * Place walkover orders for a match on ALL markets
 * On walkover, every market settles at $0.50 per outcome, so any order under $0.50 profits
 */
export async function placeWalkoverOrders(
  match: TrackedMatch,
  maxSize?: number
): Promise<{
  success: boolean;
  player1Order?: TradeResult;
  player2Order?: TradeResult;
  error?: string;
}> {
  // Use the all-markets function to bet on every outcome
  const result = await placeAllMarketWalkoverOrders(match, tennisConfig.BID_PRICE);

  // Return in legacy format for compatibility
  return {
    success: result.success,
    player1Order: result.success ? { success: true, orderId: `${result.totalOrdersPlaced} orders placed` } : { success: false, error: result.error },
    player2Order: result.success ? { success: true, orderId: `across ${result.marketsOrdered} markets` } : { success: false, error: result.error },
    error: result.error,
  };
}

/**
 * Record a placed order in the database
 */
function recordPlacedOrder(
  matchId: number,
  player: string,
  tokenId: string,
  orderId: string,
  size: number,
  avgPrice?: number
): void {
  const stmt = db().prepare(`
    INSERT INTO placed_orders (match_id, player, token_id, order_id, side, price, size, status, created_at)
    VALUES (?, ?, ?, ?, 'BUY', ?, ?, 'pending', ?)
  `);

  stmt.run(matchId, player, tokenId, orderId, avgPrice || tennisConfig.BID_PRICE, size, Math.floor(Date.now() / 1000));
}

/**
 * Mark match as having orders placed
 */
function markOrdersPlaced(matchId: number): void {
  const stmt = db().prepare(`
    UPDATE tracked_matches
    SET status = 'orders_placed', orders_placed_at = ?, updated_at = ?
    WHERE id = ?
  `);

  const now = Math.floor(Date.now() / 1000);
  stmt.run(now, now, matchId);
}

/**
 * Get open orders from Polymarket
 */
export async function getOpenOrdersList(): Promise<any[]> {
  if (!clobClient) {
    return [];
  }

  return getOpenOrders(clobClient);
}

/**
 * Cancel all open orders
 */
export async function cancelAll(): Promise<boolean> {
  if (!clobClient) {
    return false;
  }

  return cancelAllOrders(clobClient);
}

/**
 * Get placed orders for a match
 */
export function getOrdersForMatch(matchId: number): PlacedOrder[] {
  const stmt = db().prepare(`
    SELECT id, match_id as matchId, player, token_id as tokenId, order_id as orderId,
           side, price, size, status, created_at as createdAt
    FROM placed_orders
    WHERE match_id = ?
  `);

  return stmt.all(matchId) as PlacedOrder[];
}

/**
 * Get all placed orders
 */
export function getAllPlacedOrders(): PlacedOrder[] {
  const stmt = db().prepare(`
    SELECT id, match_id as matchId, player, token_id as tokenId, order_id as orderId,
           side, price, size, status, created_at as createdAt
    FROM placed_orders
    ORDER BY created_at DESC
    LIMIT 100
  `);

  return stmt.all() as PlacedOrder[];
}
