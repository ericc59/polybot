import { db } from "../db/index";
import { logger } from "../utils/logger";
import { decryptCredentials } from "../utils/crypto";
import * as tradingService from "./trading.service";
import * as consoleUI from "../utils/console-ui";
import { sendMessage } from "../telegram";
import { getMarket, type Trade } from "../api/polymarket";

export type CopyMode = "recommend" | "auto";

export interface CopySubscription {
  userId: number;
  sourceWallet: string;
  mode: CopyMode;
}

export interface TradingWallet {
  id: number;
  userId: number;
  walletAddress: string;
  encryptedCredentials: string | null;
  copyEnabled: boolean;
  copyPercentage: number;
  maxTradeSize: number | null;
  dailyLimit: number | null;
  proxyAddress: string | null;  // Polymarket proxy wallet address
}

export interface CopyTradeRecord {
  id: number;
  userId: number;
  sourceWallet: string;
  sourceTradeHash: string;
  marketConditionId: string;
  marketTitle: string;
  side: string;
  size: number;
  price: number;
  status: "pending" | "executed" | "failed" | "skipped";
  orderId: string | null;
  txHash: string | null;
  errorMessage: string | null;
  createdAt: number;
  executedAt: number | null;
}

// =============================================
// COPY SUBSCRIPTIONS
// =============================================

/**
 * Get all copy subscriptions for a user
 */
export function getCopySubscriptions(userId: number): CopySubscription[] {
  const stmt = db().prepare(`
    SELECT user_id as userId, source_wallet as sourceWallet, mode
    FROM user_copy_subscriptions
    WHERE user_id = ?
  `);
  return stmt.all(userId) as CopySubscription[];
}

/**
 * Get all users subscribed to copy a specific wallet
 * Only returns users whose tier allows copy trading
 */
export function getSubscribersForWallet(walletAddress: string): CopySubscription[] {
  const stmt = db().prepare(`
    SELECT ucs.user_id as userId, ucs.source_wallet as sourceWallet, ucs.mode
    FROM user_copy_subscriptions ucs
    JOIN users u ON ucs.user_id = u.id
    JOIN subscription_tiers st ON u.subscription_tier = st.id
    WHERE ucs.source_wallet = ?
      AND st.can_use_copy_trading = 1
      AND u.is_active = 1
      AND u.is_banned = 0
  `);
  return stmt.all(walletAddress.toLowerCase()) as CopySubscription[];
}

/**
 * Subscribe to copy a wallet
 */
export function subscribeToCopy(userId: number, sourceWallet: string, mode: CopyMode): boolean {
  try {
    const stmt = db().prepare(`
      INSERT INTO user_copy_subscriptions (user_id, source_wallet, mode)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, source_wallet) DO UPDATE SET mode = ?
    `);
    stmt.run(userId, sourceWallet.toLowerCase(), mode, mode);
    return true;
  } catch (error) {
    logger.error("Failed to subscribe to copy", error);
    return false;
  }
}

/**
 * Unsubscribe from copying a wallet
 */
export function unsubscribeFromCopy(userId: number, sourceWallet: string): boolean {
  try {
    const stmt = db().prepare(`
      DELETE FROM user_copy_subscriptions
      WHERE user_id = ? AND source_wallet = ?
    `);
    stmt.run(userId, sourceWallet.toLowerCase());
    return true;
  } catch (error) {
    logger.error("Failed to unsubscribe from copy", error);
    return false;
  }
}

// =============================================
// TRADING WALLETS
// =============================================

/**
 * Get user's connected trading wallet
 */
export function getTradingWallet(userId: number): TradingWallet | null {
  const stmt = db().prepare(`
    SELECT
      id, user_id as userId, wallet_address as walletAddress,
      encrypted_credentials as encryptedCredentials,
      copy_enabled as copyEnabled, copy_percentage as copyPercentage,
      max_trade_size as maxTradeSize, daily_limit as dailyLimit,
      proxy_address as proxyAddress
    FROM user_trading_wallets
    WHERE user_id = ?
  `);
  return stmt.get(userId) as TradingWallet | null;
}

// Safe default limits for new wallets
export const SAFE_DEFAULTS = {
  copyPercentage: 10,      // 10% of source trade size (not 100%)
  maxTradeSize: 25,        // $25 max per trade
  dailyLimit: 100,         // $100 daily cap
};

// Ultra-safe test mode limits
export const TEST_MODE_LIMITS = {
  copyPercentage: 5,       // 5% of source trade
  maxTradeSize: 10,        // $10 max per trade
  dailyLimit: 50,          // $50 daily cap
};

/**
 * Save trading wallet for user with SAFE DEFAULTS
 */
export function saveTradingWallet(
  userId: number,
  walletAddress: string,
  encryptedCredentials: string
): boolean {
  try {
    // Check if user already has a trading wallet
    const existing = getTradingWallet(userId);

    if (existing) {
      // Update existing wallet (keep existing limits)
      const stmt = db().prepare(`
        UPDATE user_trading_wallets
        SET wallet_address = ?, encrypted_credentials = ?
        WHERE user_id = ?
      `);
      stmt.run(walletAddress, encryptedCredentials, userId);
    } else {
      // Insert new wallet with SAFE DEFAULTS
      const stmt = db().prepare(`
        INSERT INTO user_trading_wallets
        (user_id, wallet_address, encrypted_credentials, copy_percentage, max_trade_size, daily_limit, copy_enabled)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `);
      stmt.run(
        userId,
        walletAddress,
        encryptedCredentials,
        SAFE_DEFAULTS.copyPercentage,
        SAFE_DEFAULTS.maxTradeSize,
        SAFE_DEFAULTS.dailyLimit
      );
    }
    return true;
  } catch (error) {
    logger.error("Failed to save trading wallet", error);
    return false;
  }
}

/**
 * Apply test mode limits (ultra-safe for testing with real money)
 */
export function applyTestModeLimits(userId: number): boolean {
  return updateTradingSettings(userId, {
    copyPercentage: TEST_MODE_LIMITS.copyPercentage,
    maxTradeSize: TEST_MODE_LIMITS.maxTradeSize,
    dailyLimit: TEST_MODE_LIMITS.dailyLimit,
    copyEnabled: false, // Start disabled, require explicit enable
  });
}

/**
 * Update trading wallet settings
 */
export function updateTradingSettings(
  userId: number,
  settings: {
    copyEnabled?: boolean;
    copyPercentage?: number;
    maxTradeSize?: number | null;
    dailyLimit?: number | null;
  }
): boolean {
  try {
    const updates: string[] = [];
    const values: any[] = [];

    if (settings.copyEnabled !== undefined) {
      updates.push("copy_enabled = ?");
      values.push(settings.copyEnabled ? 1 : 0);
    }
    if (settings.copyPercentage !== undefined) {
      updates.push("copy_percentage = ?");
      values.push(settings.copyPercentage);
    }
    if (settings.maxTradeSize !== undefined) {
      updates.push("max_trade_size = ?");
      values.push(settings.maxTradeSize);
    }
    if (settings.dailyLimit !== undefined) {
      updates.push("daily_limit = ?");
      values.push(settings.dailyLimit);
    }

    if (updates.length === 0) return true;

    values.push(userId);
    const stmt = db().prepare(`
      UPDATE user_trading_wallets
      SET ${updates.join(", ")}
      WHERE user_id = ?
    `);
    stmt.run(...values);
    return true;
  } catch (error) {
    logger.error("Failed to update trading settings", error);
    return false;
  }
}

/**
 * Set the proxy wallet address for a user's trading wallet
 */
export function setProxyAddress(userId: number, proxyAddress: string): boolean {
  try {
    const stmt = db().prepare(`
      UPDATE user_trading_wallets
      SET proxy_address = ?
      WHERE user_id = ?
    `);
    stmt.run(proxyAddress, userId);
    return true;
  } catch (error) {
    logger.error("Failed to set proxy address", error);
    return false;
  }
}

/**
 * Delete trading wallet
 */
export function deleteTradingWallet(userId: number): boolean {
  try {
    const stmt = db().prepare("DELETE FROM user_trading_wallets WHERE user_id = ?");
    stmt.run(userId);
    return true;
  } catch (error) {
    logger.error("Failed to delete trading wallet", error);
    return false;
  }
}

// =============================================
// COPY TRADE HISTORY
// =============================================

/**
 * Log a copy trade attempt
 */
export function logCopyTrade(
  record: Omit<CopyTradeRecord, "id" | "createdAt" | "executedAt">
): number {
  const stmt = db().prepare(`
    INSERT INTO copy_trade_history
    (user_id, source_wallet, source_trade_hash, market_condition_id, market_title, side, size, price, status, order_id, tx_hash, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    record.userId,
    record.sourceWallet,
    record.sourceTradeHash,
    record.marketConditionId,
    record.marketTitle,
    record.side,
    record.size,
    record.price,
    record.status,
    record.orderId,
    record.txHash,
    record.errorMessage
  );
  return result.lastInsertRowid as number;
}

/**
 * Update copy trade status
 */
export function updateCopyTradeStatus(
  id: number,
  status: CopyTradeRecord["status"],
  orderId?: string,
  txHash?: string,
  errorMessage?: string
): void {
  const stmt = db().prepare(`
    UPDATE copy_trade_history
    SET status = ?, order_id = ?, tx_hash = ?, error_message = ?, executed_at = ?
    WHERE id = ?
  `);
  stmt.run(status, orderId || null, txHash || null, errorMessage || null, Date.now() / 1000, id);
}

/**
 * Get today's copy trade total for a user
 */
export function getTodaysCopyTotal(userId: number): number {
  const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const stmt = db().prepare(`
    SELECT COALESCE(SUM(size * price), 0) as total
    FROM copy_trade_history
    WHERE user_id = ? AND status = 'executed' AND created_at >= ?
  `);
  const result = stmt.get(userId, startOfDay) as { total: number };
  return result.total;
}

/**
 * Get user's copy trade history
 */
export function getCopyTradeHistory(userId: number, limit = 20): CopyTradeRecord[] {
  const stmt = db().prepare(`
    SELECT
      id, user_id as userId, source_wallet as sourceWallet,
      source_trade_hash as sourceTradeHash, market_condition_id as marketConditionId,
      market_title as marketTitle, side, size, price, status,
      order_id as orderId, tx_hash as txHash, error_message as errorMessage,
      created_at as createdAt, executed_at as executedAt
    FROM copy_trade_history
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT ?
  `);
  return stmt.all(userId, limit) as CopyTradeRecord[];
}

// =============================================
// COPY TRADE EXECUTION
// =============================================

/**
 * Process a trade for copy-trading
 * Called when a tracked wallet makes a trade
 */
export async function processCopyTrade(
  sourceWallet: string,
  trade: Trade,
  tradeHash: string
): Promise<{ recommended: number; executed: number; failed: number; totalCopySize: number; fillPrice?: number }> {
  const stats: { recommended: number; executed: number; failed: number; totalCopySize: number; fillPrice?: number } = {
    recommended: 0,
    executed: 0,
    failed: 0,
    totalCopySize: 0,
  };

  // Get all users subscribed to copy this wallet
  const subscribers = getSubscribersForWallet(sourceWallet);

  if (subscribers.length === 0) {
    return stats;
  }

  const tradeSize = parseFloat(trade.size) * parseFloat(trade.price);

  for (const sub of subscribers) {
    try {
      if (sub.mode === "recommend") {
        // Send recommendation message
        await sendCopyRecommendation(sub.userId, trade, tradeSize);
        stats.recommended++;
      } else if (sub.mode === "auto") {
        // Execute copy trade
        const result = await executeCopyTrade(sub.userId, trade, tradeHash, tradeSize);
        if (result.success) {
          stats.executed++;
          stats.totalCopySize += result.copySize || 0;
          // Track the fill price (use last executed price if multiple)
          if (result.fillPrice !== undefined) {
            stats.fillPrice = result.fillPrice;
          }
        } else {
          stats.failed++;
        }
      }
    } catch (error) {
      logger.error(`Failed to process copy trade for user ${sub.userId}`, error);
      stats.failed++;
    }
  }

  return stats;
}

/**
 * Send a copy trade recommendation to user
 */
async function sendCopyRecommendation(userId: number, trade: Trade, tradeSize: number): Promise<void> {
  // Get user's chat ID
  const userStmt = db().prepare("SELECT telegram_chat_id FROM users WHERE id = ?");
  const user = userStmt.get(userId) as { telegram_chat_id: string } | null;

  if (!user) return;

  const sideEmoji = trade.side === "BUY" ? "🟢" : "🔴";
  const message = [
    `${sideEmoji} *Copy Trade Opportunity*`,
    ``,
    `*Market:* ${trade.title}`,
    `*Outcome:* ${trade.outcome}`,
    `*Side:* ${trade.side}`,
    `*Size:* $${tradeSize.toFixed(0)} @ ${(parseFloat(trade.price) * 100).toFixed(0)}¢`,
    ``,
    `[Copy on Polymarket](https://polymarket.com/event/${trade.slug})`,
  ].join("\n");

  await sendMessage(user.telegram_chat_id, message, { parseMode: "Markdown" });
}

/**
 * Execute an auto copy trade
 */
async function executeCopyTrade(
  userId: number,
  trade: Trade,
  tradeHash: string,
  sourceTradeSize: number
): Promise<{ success: boolean; error?: string; copySize?: number; fillPrice?: number }> {
  // Get user's trading wallet
  const tradingWallet = getTradingWallet(userId);

  if (!tradingWallet || !tradingWallet.encryptedCredentials) {
    return { success: false, error: "No trading wallet connected" };
  }

  if (!tradingWallet.copyEnabled) {
    return { success: false, error: "Copy trading disabled" };
  }

  // Decrypt credentials and create client first (need for balance check)
  const credentials = decryptCredentials(tradingWallet.encryptedCredentials);

  let client;
  try {
    client = await tradingService.createClobClient(
      (credentials as any).privateKey,
      {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        passphrase: credentials.passphrase,
      },
      tradingWallet.proxyAddress || undefined  // Pass proxy address if set
    );
  } catch (error) {
    return { success: false, error: "Failed to connect to trading API" };
  }

  // Get user's current balance for proportional sizing
  const { balance: userBalance } = await tradingService.getBalance(client, tradingWallet.proxyAddress || undefined);

  if (userBalance <= 0) {
    logCopyTrade({
      userId,
      sourceWallet: trade.taker || trade.maker,
      sourceTradeHash: tradeHash,
      marketConditionId: trade.conditionId,
      marketTitle: trade.title,
      side: trade.side,
      size: 0,
      price: parseFloat(trade.price),
      status: "skipped",
      orderId: null,
      txHash: null,
      errorMessage: "Insufficient balance",
    });
    return { success: false, error: "Insufficient balance" };
  }

  // Smart copy sizing:
  // - If whale trade is small (affordable), copy 1:1
  // - If whale trade is large, cap at % of your balance
  const maxAffordable = userBalance * (tradingWallet.copyPercentage / 100);
  let copySize = Math.min(sourceTradeSize, maxAffordable);

  // Apply max trade size limit
  if (tradingWallet.maxTradeSize && copySize > tradingWallet.maxTradeSize) {
    copySize = tradingWallet.maxTradeSize;
  }

  // Also cap at user's available balance
  if (copySize > userBalance) {
    copySize = userBalance;
  }

  // Skip if whale's trade is too small (not worth copying)
  if (sourceTradeSize < 10) {
    return { success: false, error: "Whale trade too small (min $10)" };
  }

  // Minimum copy size ($1)
  if (copySize < 1) {
    return { success: false, error: "Copy size too small (min $1)" };
  }

  logger.debug(`Copy sizing: whale=$${sourceTradeSize.toFixed(0)}, you=$${copySize.toFixed(2)} (balance=$${userBalance.toFixed(0)}, max=${tradingWallet.copyPercentage}%)`)

  // Check daily limit
  if (tradingWallet.dailyLimit) {
    const todaysTotal = getTodaysCopyTotal(userId);
    if (todaysTotal + copySize > tradingWallet.dailyLimit) {
      // Log skipped trade
      logCopyTrade({
        userId,
        sourceWallet: trade.taker || trade.maker,
        sourceTradeHash: tradeHash,
        marketConditionId: trade.conditionId,
        marketTitle: trade.title,
        side: trade.side,
        size: copySize,
        price: parseFloat(trade.price),
        status: "skipped",
        orderId: null,
        txHash: null,
        errorMessage: "Daily limit exceeded",
      });
      return { success: false, error: "Daily limit exceeded" };
    }
  }

  try {
    // Resolve tokenId (asset) - may need to fetch from market API
    let tokenId = trade.asset;
    if (!tokenId) {
      logger.warn(`Missing tokenId (asset) for trade on ${trade.title}, fetching from market API...`);
      try {
        const market = await getMarket(trade.conditionId);
        if (market && market.tokenIds && market.tokenIds.length > 0) {
          // Use outcomeIndex to get the correct tokenId (0 = Yes, 1 = No typically)
          const outcomeIndex = trade.outcomeIndex || 0;
          const fetchedTokenId = market.tokenIds[outcomeIndex];
          if (fetchedTokenId) {
            tokenId = fetchedTokenId;
            logger.info(`Fetched tokenId ${tokenId.slice(0, 20)}... from market API for outcome ${outcomeIndex}`);
          }
        }
      } catch (err) {
        logger.error(`Failed to fetch market for conditionId ${trade.conditionId}`, err);
      }
    }

    if (!tokenId) {
      logger.error(`Missing tokenId (asset) for trade on ${trade.title}. conditionId: ${trade.conditionId}`);
      logCopyTrade({
        userId,
        sourceWallet: trade.taker || trade.maker,
        sourceTradeHash: tradeHash,
        marketConditionId: trade.conditionId,
        marketTitle: trade.title,
        side: trade.side,
        size: copySize,
        price: parseFloat(trade.price),
        status: "failed",
        orderId: null,
        txHash: null,
        errorMessage: "Missing tokenId (asset) in trade data",
      });
      return { success: false, error: "Missing tokenId (asset) in trade data" };
    }

    logger.debug(`Copy trade tokenId: ${tokenId.slice(0, 20)}..., conditionId: ${trade.conditionId}`);

    // For SELL orders, check our actual position and adjust
    if (trade.side === "SELL") {
      const position = await tradingService.getPosition(client, tokenId);

      if (!position || position.size <= 0) {
        // Log skipped trade - no position to sell
        logCopyTrade({
          userId,
          sourceWallet: trade.taker || trade.maker,
          sourceTradeHash: tradeHash,
          marketConditionId: trade.conditionId,
          marketTitle: trade.title,
          side: trade.side,
          size: copySize,
          price: parseFloat(trade.price),
          status: "skipped",
          orderId: null,
          txHash: null,
          errorMessage: "No position to sell",
        });
        return { success: false, error: "No position to sell" };
      }

      // Sell whatever we have, up to copySize (in shares for SELL)
      const sharesToSell = Math.min(copySize / parseFloat(trade.price), position.size);
      copySize = sharesToSell; // For SELL, amount is in shares
    }

    // Log the pending trade
    const recordId = logCopyTrade({
      userId,
      sourceWallet: trade.taker || trade.maker,
      sourceTradeHash: tradeHash,
      marketConditionId: trade.conditionId,
      marketTitle: trade.title,
      side: trade.side,
      size: copySize,
      price: parseFloat(trade.price),
      status: "pending",
      orderId: null,
      txHash: null,
      errorMessage: null,
    });

    // Check current market price - only execute if we can get whale's price or better
    const whalePrice = parseFloat(trade.price);

    let currentPrice: number | null = null;
    try {
      currentPrice = await tradingService.getMarketPrice(client, tokenId, trade.side);
    } catch {
      // Price check failed, skip
    }

    if (currentPrice === null) {
      updateCopyTradeStatus(recordId, "skipped", undefined, undefined, "Could not get market price");
      logger.info(`Skipped copy trade - could not get market price for ${trade.title}`);
      return { success: false, error: "Could not get market price" };
    }

    // For BUY: only proceed if current price <= whale's price (same or better)
    // For SELL: only proceed if current price >= whale's price (same or better)
    const priceOk = trade.side === "BUY"
      ? currentPrice <= whalePrice * 1.02  // Allow 2% slippage for BUY
      : currentPrice >= whalePrice * 0.98; // Allow 2% slippage for SELL

    if (!priceOk) {
      updateCopyTradeStatus(recordId, "skipped", undefined, undefined, "Price moved");
      logger.info(`Skipped copy trade - price moved (whale: ${(whalePrice * 100).toFixed(1)}¢, current: ${(currentPrice * 100).toFixed(1)}¢)`);
      return { success: false, error: "Price moved - skipped" };
    }

    logger.info(`Placing FOK order: ${trade.side} $${copySize.toFixed(2)} @ ${(currentPrice * 100).toFixed(1)}¢ (whale: ${(whalePrice * 100).toFixed(1)}¢)`);

    // Place FOK market order - fills immediately or fails
    const result = await tradingService.placeMarketOrder(client, {
      tokenId,
      side: trade.side,
      amount: copySize,
    });

    if (result.success) {
      updateCopyTradeStatus(recordId, "executed", result.orderId, result.txHash);

      // Notify user
      const userStmt = db().prepare("SELECT telegram_chat_id FROM users WHERE id = ?");
      const user = userStmt.get(userId) as { telegram_chat_id: string } | null;

      const fillPrice = result.fillPrice ?? currentPrice;
      const copyDollarValue = trade.side === "SELL"
        ? copySize * fillPrice
        : copySize;

      if (user) {
        const valueStr = trade.side === "SELL"
          ? `${copySize.toFixed(1)} shares`
          : `$${copySize.toFixed(0)}`;
        const priceStr = `@ ${(fillPrice * 100).toFixed(1)}¢`;
        await sendMessage(
          user.telegram_chat_id,
          `✅ *Copy Trade Filled*\n\n${trade.side} ${valueStr} ${priceStr}\n${trade.title}`,
          { parseMode: "Markdown" }
        );
      }

      return { success: true, copySize: copyDollarValue, fillPrice };
    } else {
      // Check if it's a liquidity issue
      const isLiquidityIssue = result.error?.includes("No liquidity") || result.error?.includes("no match");

      if (isLiquidityIssue) {
        updateCopyTradeStatus(recordId, "skipped", undefined, undefined, "No liquidity");
        logger.info(`Skipped copy trade - no liquidity for ${trade.title}`);
        return { success: false, error: "No liquidity - skipped" };
      }

      updateCopyTradeStatus(recordId, "failed", undefined, undefined, result.error);
      return { success: false, error: result.error };
    }
  } catch (error: any) {
    // Log failed trade
    logCopyTrade({
      userId,
      sourceWallet: trade.taker || trade.maker,
      sourceTradeHash: tradeHash,
      marketConditionId: trade.conditionId,
      marketTitle: trade.title,
      side: trade.side,
      size: copySize,
      price: parseFloat(trade.price),
      status: "failed",
      orderId: null,
      txHash: null,
      errorMessage: error.message,
    });
    return { success: false, error: error.message };
  }
}

/**
 * Generate a Polymarket deep link for a trade
 */
export function generateCopyLink(trade: Trade): string {
  // Polymarket doesn't have a true deep link for trades
  // Best we can do is link to the market page
  return `https://polymarket.com/event/${trade.slug}`;
}

// =============================================
// AUTO-REDEMPTION FOR REAL COPY TRADING
// =============================================

/**
 * Redeem resolved positions for all users with connected trading wallets
 */
export async function redeemResolvedPositions(): Promise<{
  redeemed: number;
  totalValue: number;
  positions: Array<{ userId: number; title: string; outcome: string; won: boolean; value: number }>;
}> {
  let redeemed = 0;
  let totalValue = 0;
  const redeemedPositions: Array<{ userId: number; title: string; outcome: string; won: boolean; value: number }> = [];

  // Get all users with connected trading wallets
  const users = db().prepare(`
    SELECT
      utw.user_id as userId,
      utw.encrypted_credentials as encryptedCredentials,
      utw.proxy_address as proxyAddress
    FROM user_trading_wallets utw
    JOIN users u ON utw.user_id = u.id
    WHERE utw.encrypted_credentials IS NOT NULL
      AND u.is_active = 1
      AND u.is_banned = 0
  `).all() as Array<{ userId: number; encryptedCredentials: string; proxyAddress: string | null }>;

  if (users.length === 0) {
    return { redeemed: 0, totalValue: 0, positions: [] };
  }

  logger.info(`Checking positions for ${users.length} users with connected wallets...`);

  for (const user of users) {
    try {
      // Decrypt credentials and create client
      const credentials = decryptCredentials(user.encryptedCredentials);
      const client = await tradingService.createClobClient(
        (credentials as any).privateKey,
        {
          apiKey: credentials.apiKey,
          apiSecret: credentials.apiSecret,
          passphrase: credentials.passphrase,
        },
        user.proxyAddress || undefined  // Pass proxy address if set
      );

      // Get all positions
      const positions = await tradingService.getAllPositions(client);

      if (positions.length === 0) {
        continue;
      }

      // Check each position for resolution
      for (const pos of positions) {
        if (!pos.conditionId) continue;

        const resolution = await tradingService.getMarketResolution(pos.conditionId);

        if (!resolution || !resolution.resolved) {
          continue;
        }

        // Determine if this position won
        const won = pos.outcome?.toLowerCase() === resolution.winningOutcome?.toLowerCase();
        const redemptionValue = won ? pos.size : 0; // $1 per share for winners, $0 for losers

        // Redeem the position
        const result = await tradingService.redeemPosition(client, pos.tokenId, pos.size, won);

        if (result.success) {
          redeemed++;
          totalValue += redemptionValue;
          redeemedPositions.push({
            userId: user.userId,
            title: pos.marketTitle || "Unknown",
            outcome: pos.outcome || "",
            won,
            value: redemptionValue,
          });

          // Log the redemption
          logCopyTrade({
            userId: user.userId,
            sourceWallet: "REDEMPTION",
            sourceTradeHash: `REDEEM_${pos.tokenId}_${Date.now()}`,
            marketConditionId: pos.conditionId,
            marketTitle: pos.marketTitle || "",
            side: "REDEEM",
            size: pos.size,
            price: won ? 1.0 : 0,
            status: "executed",
            orderId: result.orderId || null,
            txHash: result.txHash || null,
            errorMessage: null,
          });

          // Notify user
          const userStmt = db().prepare("SELECT telegram_chat_id FROM users WHERE id = ?");
          const userRecord = userStmt.get(user.userId) as { telegram_chat_id: string } | null;
          if (userRecord) {
            const wonText = won ? "🎉 WON" : "❌ LOST";
            const valueText = won ? `+$${redemptionValue.toFixed(2)}` : "$0.00";
            await sendMessage(
              userRecord.telegram_chat_id,
              `🎯 *Position Redeemed*\n\n${wonText}\n*Market:* ${pos.marketTitle}\n*Outcome:* ${pos.outcome}\n*Value:* ${valueText}`,
              { parseMode: "Markdown" }
            );
          }

          const wonLog = won ? "WON" : "LOST";
          const valueLog = redemptionValue > 0 ? `+$${redemptionValue.toFixed(2)}` : "$0.00";
          logger.info(`User ${user.userId} redeemed: ${pos.marketTitle?.slice(0, 40)}... [${pos.outcome}] - ${wonLog} ${valueLog}`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      logger.error(`Failed to check redemptions for user ${user.userId}`, error);
    }
  }

  if (redeemed > 0) {
    logger.success(`Real trading: Redeemed ${redeemed} positions for $${totalValue.toFixed(2)}`);
  }

  return { redeemed, totalValue, positions: redeemedPositions };
}

// Interval handle for real trading redemption monitor
let realRedemptionInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic redemption checking for real copy trading (every 5 minutes)
 */
export function startRealRedemptionMonitor(intervalMs: number = 5 * 60 * 1000): void {
  if (realRedemptionInterval) {
    return; // Already running
  }

  logger.info(`Starting real trading redemption monitor (checking every ${intervalMs / 1000}s)`);

  realRedemptionInterval = setInterval(async () => {
    try {
      const result = await redeemResolvedPositions();
      if (result.redeemed > 0) {
        // Display redemptions in console
        for (const pos of result.positions) {
          consoleUI.displayRedemption({
            title: pos.title,
            outcome: pos.outcome,
            won: pos.won,
            value: pos.value,
          });
        }
      }
    } catch (error) {
      logger.error("Real trading redemption check failed", error);
    }
  }, intervalMs);
}

/**
 * Stop real trading redemption monitor
 */
export function stopRealRedemptionMonitor(): void {
  if (realRedemptionInterval) {
    clearInterval(realRedemptionInterval);
    realRedemptionInterval = null;
    logger.info("Real trading redemption monitor stopped");
  }
}

/**
 * Initialize real copy trading and check for redemptions
 * Call this on startup
 */
export async function initAndCheckRedemptions(): Promise<void> {
  // Check for any resolved positions that need redemption
  const result = await redeemResolvedPositions();
  if (result.redeemed > 0) {
    logger.success(`Real trading startup: Redeemed ${result.redeemed} positions for $${result.totalValue.toFixed(2)}`);
  }
}
