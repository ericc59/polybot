import { db } from "../db/index";
import { logger } from "../utils/logger";
import * as consoleUI from "../utils/console-ui";
import * as priceService from "./price.service";
import { getMarket, type Trade } from "../api/polymarket";

// Extended market info for resolution checking
interface MarketResolution {
  resolved: boolean;
  winningOutcome: string | null;
  outcomes: Array<{ outcome: string; winner: boolean }>;
}

export interface PaperPortfolio {
  id: number;
  userId: number;
  wallets: string[];
  startingBalance: number;
  currentCash: number;
  positions: PaperPosition[];
  totalValue: number;
  pnl: number;
  pnlPercent: number;
  trades: number;
  startedAt: number;
}

export interface PaperPosition {
  conditionId: string;
  marketTitle: string;
  outcome: string;
  sourceWallet: string;
  side: "LONG" | "SHORT";
  shares: number;
  avgPrice: number;
  currentPrice: number;
  value: number;
  cost: number;
  pnl: number;
  pnlPercent: number;
  isWinning: boolean;
  hasPriceData: boolean;
  endDate: number | null; // Unix timestamp when market resolves
}

export interface PaperTrade {
  id: number;
  portfolioId: number;
  sourceWallet: string;
  conditionId: string;
  marketTitle: string;
  outcome: string;
  side: "BUY" | "SELL";
  shares: number;
  price: number;
  value: number;
  timestamp: number;
}

// Initialize paper trading tables
export function initPaperTables(): void {
  db().exec(`
    CREATE TABLE IF NOT EXISTS paper_portfolios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      starting_balance REAL NOT NULL,
      current_cash REAL NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      is_active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS paper_portfolio_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id INTEGER NOT NULL REFERENCES paper_portfolios(id),
      wallet_address TEXT NOT NULL,
      added_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE(portfolio_id, wallet_address)
    );

    CREATE TABLE IF NOT EXISTS paper_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id INTEGER NOT NULL REFERENCES paper_portfolios(id),
      condition_id TEXT NOT NULL,
      asset_id TEXT,
      source_wallet TEXT,
      market_title TEXT,
      outcome TEXT,
      shares REAL NOT NULL,
      avg_price REAL NOT NULL,
      end_date INTEGER,
      UNIQUE(portfolio_id, condition_id, asset_id)
    );

    CREATE TABLE IF NOT EXISTS paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id INTEGER NOT NULL REFERENCES paper_portfolios(id),
      source_wallet TEXT,
      condition_id TEXT NOT NULL,
      market_title TEXT,
      outcome TEXT,
      side TEXT NOT NULL,
      shares REAL NOT NULL,
      price REAL NOT NULL,
      value REAL NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE TABLE IF NOT EXISTS paper_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      portfolio_id INTEGER NOT NULL REFERENCES paper_portfolios(id),
      total_value REAL NOT NULL,
      cash REAL NOT NULL,
      positions_value REAL NOT NULL,
      pnl REAL NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    CREATE INDEX IF NOT EXISTS idx_paper_snapshots_portfolio_time
    ON paper_snapshots(portfolio_id, created_at);
  `);

  // Migration: add asset_id column if it doesn't exist
  try {
    db().exec(`ALTER TABLE paper_positions ADD COLUMN asset_id TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Migration: add end_date column if it doesn't exist
  try {
    db().exec(`ALTER TABLE paper_positions ADD COLUMN end_date INTEGER`);
  } catch (e) {
    // Column already exists, ignore
  }

  // Migration: recreate paper_positions table to fix UNIQUE constraint
  // The old constraint was (portfolio_id, condition_id) but we need (portfolio_id, asset_id)
  try {
    const hasOldConstraint = db().prepare(`
      SELECT sql FROM sqlite_master
      WHERE type='table' AND name='paper_positions' AND sql LIKE '%UNIQUE(portfolio_id, condition_id)%'
    `).get();

    if (hasOldConstraint) {
      logger.info("Migrating paper_positions table to fix UNIQUE constraint...");

      // Create new table with correct constraint
      db().exec(`
        CREATE TABLE IF NOT EXISTS paper_positions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          portfolio_id INTEGER NOT NULL REFERENCES paper_portfolios(id),
          condition_id TEXT NOT NULL,
          asset_id TEXT,
          source_wallet TEXT,
          market_title TEXT,
          outcome TEXT,
          shares REAL NOT NULL,
          avg_price REAL NOT NULL,
          end_date INTEGER,
          UNIQUE(portfolio_id, asset_id)
        );

        INSERT INTO paper_positions_new
        SELECT id, portfolio_id, condition_id, asset_id, source_wallet, market_title, outcome, shares, avg_price, NULL
        FROM paper_positions;

        DROP TABLE paper_positions;

        ALTER TABLE paper_positions_new RENAME TO paper_positions;
      `);

      logger.info("Migration complete");
    }
  } catch (e) {
    logger.warn("Could not migrate paper_positions table - may need manual intervention", e);
  }
}

/**
 * Start paper trading with an initial balance
 */
export function startPaperTrading(
  userId: number,
  startingBalance: number
): { success: boolean; portfolioId?: number; error?: string } {
  try {
    initPaperTables();

    // Check if already has active portfolio
    const existing = db().prepare(`
      SELECT id FROM paper_portfolios
      WHERE user_id = ? AND is_active = 1
    `).get(userId) as { id: number } | null;

    if (existing) {
      return { success: false, error: "You already have an active paper portfolio. Use /paper stop to end it first." };
    }

    const result = db().prepare(`
      INSERT INTO paper_portfolios (user_id, starting_balance, current_cash)
      VALUES (?, ?, ?)
    `).run(userId, startingBalance, startingBalance);

    logger.info(`Started paper trading for user ${userId} with $${startingBalance}`);

    return { success: true, portfolioId: Number(result.lastInsertRowid) };
  } catch (error: any) {
    logger.error("Failed to start paper trading", error);
    return { success: false, error: error.message };
  }
}

/**
 * Add a wallet to track in the paper portfolio
 */
export function addWalletToPortfolio(
  userId: number,
  walletAddress: string
): { success: boolean; error?: string } {
  try {
    initPaperTables();

    const portfolio = db().prepare(`
      SELECT id FROM paper_portfolios
      WHERE user_id = ? AND is_active = 1
    `).get(userId) as { id: number } | null;

    if (!portfolio) {
      return { success: false, error: "No active paper portfolio. Use /paper start first." };
    }

    // Check if already tracking
    const existing = db().prepare(`
      SELECT id FROM paper_portfolio_wallets
      WHERE portfolio_id = ? AND wallet_address = ?
    `).get(portfolio.id, walletAddress.toLowerCase()) as { id: number } | null;

    if (existing) {
      return { success: false, error: "Already tracking this wallet" };
    }

    db().prepare(`
      INSERT INTO paper_portfolio_wallets (portfolio_id, wallet_address)
      VALUES (?, ?)
    `).run(portfolio.id, walletAddress.toLowerCase());

    logger.info(`Added wallet ${walletAddress} to paper portfolio for user ${userId}`);

    return { success: true };
  } catch (error: any) {
    logger.error("Failed to add wallet to paper portfolio", error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove a wallet from the paper portfolio
 */
export function removeWalletFromPortfolio(
  userId: number,
  walletAddress: string
): { success: boolean; error?: string } {
  try {
    const portfolio = db().prepare(`
      SELECT id FROM paper_portfolios
      WHERE user_id = ? AND is_active = 1
    `).get(userId) as { id: number } | null;

    if (!portfolio) {
      return { success: false, error: "No active paper portfolio" };
    }

    const result = db().prepare(`
      DELETE FROM paper_portfolio_wallets
      WHERE portfolio_id = ? AND wallet_address = ?
    `).run(portfolio.id, walletAddress.toLowerCase());

    if (result.changes === 0) {
      return { success: false, error: "Wallet not found in portfolio" };
    }

    logger.info(`Removed wallet ${walletAddress} from paper portfolio for user ${userId}`);

    return { success: true };
  } catch (error: any) {
    logger.error("Failed to remove wallet from paper portfolio", error);
    return { success: false, error: error.message };
  }
}

/**
 * Stop paper trading and deactivate portfolio
 */
export function stopPaperTrading(userId: number): { success: boolean; portfolio?: PaperPortfolio } {
  const portfolio = getPaperPortfolio(userId);

  const result = db().prepare(`
    UPDATE paper_portfolios SET is_active = 0
    WHERE user_id = ? AND is_active = 1
  `).run(userId);

  if (result.changes === 0) {
    return { success: false };
  }

  return { success: true, portfolio: portfolio || undefined };
}

/**
 * Completely delete a paper portfolio and all related data
 */
export function deletePaperPortfolio(userId: number): boolean {
  try {
    // Get portfolio ID first
    const portfolio = db().prepare(`
      SELECT id FROM paper_portfolios WHERE user_id = ?
    `).get(userId) as { id: number } | null;

    if (!portfolio) {
      return true; // Nothing to delete
    }

    // Delete related data
    db().prepare(`DELETE FROM paper_trades WHERE portfolio_id = ?`).run(portfolio.id);
    db().prepare(`DELETE FROM paper_positions WHERE portfolio_id = ?`).run(portfolio.id);
    db().prepare(`DELETE FROM paper_portfolio_wallets WHERE portfolio_id = ?`).run(portfolio.id);
    db().prepare(`DELETE FROM paper_snapshots WHERE portfolio_id = ?`).run(portfolio.id);

    // Delete portfolio
    db().prepare(`DELETE FROM paper_portfolios WHERE id = ?`).run(portfolio.id);

    logger.info(`Deleted paper portfolio for user ${userId}`);
    return true;
  } catch (error) {
    logger.error("Failed to delete paper portfolio", error);
    return false;
  }
}

/**
 * Reset paper portfolio - clear positions and reset balance
 * Keeps tracked wallets and trade history
 */
export function resetPaperPortfolio(userId: number, newBalance: number): { success: boolean; error?: string } {
  try {
    const portfolio = db().prepare(`
      SELECT id FROM paper_portfolios WHERE user_id = ?
    `).get(userId) as { id: number } | null;

    if (!portfolio) {
      return { success: false, error: "No paper portfolio found" };
    }

    // Clear all positions
    db().prepare(`DELETE FROM paper_positions WHERE portfolio_id = ?`).run(portfolio.id);

    // Reset balance
    db().prepare(`
      UPDATE paper_portfolios
      SET starting_balance = ?, current_cash = ?, is_active = 1
      WHERE id = ?
    `).run(newBalance, newBalance, portfolio.id);

    logger.info(`Reset paper portfolio for user ${userId} to $${newBalance}`);
    return { success: true };
  } catch (error: any) {
    logger.error("Failed to reset paper portfolio", error);
    return { success: false, error: error.message };
  }
}

/**
 * Add funds to paper portfolio
 */
export function topUpPaperPortfolio(userId: number, amount: number): { success: boolean; newBalance?: number; error?: string } {
  if (amount <= 0) {
    return { success: false, error: "Amount must be positive" };
  }

  const portfolio = db().prepare(`
    SELECT id, current_cash, starting_balance
    FROM paper_portfolios
    WHERE user_id = ? AND is_active = 1
  `).get(userId) as { id: number; current_cash: number; starting_balance: number } | null;

  if (!portfolio) {
    return { success: false, error: "No active paper portfolio" };
  }

  const newCash = portfolio.current_cash + amount;
  const newStarting = portfolio.starting_balance + amount;

  db().prepare(`
    UPDATE paper_portfolios
    SET current_cash = ?, starting_balance = ?
    WHERE id = ?
  `).run(newCash, newStarting, portfolio.id);

  logger.info(`Added $${amount} to paper portfolio for user ${userId}. New balance: $${newCash.toFixed(2)}`);

  return { success: true, newBalance: newCash };
}

/**
 * Get the active paper portfolio for a user
 */
export function getPaperPortfolio(userId: number): PaperPortfolio | null {
  initPaperTables();

  const portfolio = db().prepare(`
    SELECT id, starting_balance, current_cash, created_at
    FROM paper_portfolios
    WHERE user_id = ? AND is_active = 1
  `).get(userId) as {
    id: number;
    starting_balance: number;
    current_cash: number;
    created_at: number;
  } | null;

  if (!portfolio) return null;

  // Get tracked wallets
  const wallets = db().prepare(`
    SELECT wallet_address FROM paper_portfolio_wallets
    WHERE portfolio_id = ?
  `).all(portfolio.id) as Array<{ wallet_address: string }>;

  const positions = getPortfolioPositions(portfolio.id);
  const trades = db().prepare(`
    SELECT COUNT(*) as count FROM paper_trades WHERE portfolio_id = ?
  `).get(portfolio.id) as { count: number };

  const positionValue = positions.reduce((sum, pos) => sum + pos.value, 0);
  const totalValue = portfolio.current_cash + positionValue;
  const pnl = totalValue - portfolio.starting_balance;

  return {
    id: portfolio.id,
    userId,
    wallets: wallets.map(w => w.wallet_address),
    startingBalance: portfolio.starting_balance,
    currentCash: portfolio.current_cash,
    positions,
    totalValue,
    pnl,
    pnlPercent: (pnl / portfolio.starting_balance) * 100,
    trades: trades.count,
    startedAt: portfolio.created_at,
  };
}

/**
 * Get positions for a portfolio with real-time prices
 */
export function getPortfolioPositions(portfolioId: number): PaperPosition[] {
  const positions = db().prepare(`
    SELECT condition_id, asset_id, source_wallet, market_title, outcome, shares, avg_price, end_date
    FROM paper_positions
    WHERE portfolio_id = ? AND shares > 0
  `).all(portfolioId) as Array<{
    condition_id: string;
    asset_id: string | null;
    source_wallet: string;
    market_title: string;
    outcome: string;
    shares: number;
    avg_price: number;
    end_date: number | null;
  }>;

  return positions.map((pos) => {
    // Get real-time price from cache using asset_id (unique per outcome)
    // Fallback to condition_id for old positions, then to avg_price
    const priceKey = pos.asset_id || pos.condition_id;
    const cachedPrice = priceService.getPrice(priceKey);
    const currentPrice = cachedPrice ?? pos.avg_price;
    const hasPriceData = cachedPrice !== null;

    const cost = pos.shares * pos.avg_price;
    const value = pos.shares * currentPrice;
    const pnl = value - cost;
    const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0;

    return {
      conditionId: pos.condition_id,
      marketTitle: pos.market_title || "Unknown",
      outcome: pos.outcome || "",
      sourceWallet: pos.source_wallet || "",
      side: "LONG" as const,
      shares: pos.shares,
      avgPrice: pos.avg_price,
      currentPrice,
      value,
      cost,
      pnl,
      pnlPercent,
      isWinning: pnl >= 0,
      hasPriceData,
      endDate: pos.end_date,
    };
  });
}

/**
 * Process a paper trade (called when we detect a whale trade)
 */
export async function processPaperTrade(
  userId: number,
  sourceWallet: string,
  trade: Trade,
  copyPercentage: number = 100
): Promise<{ success: boolean; trade?: PaperTrade; error?: string }> {
  try {
    // Get portfolio that tracks this wallet
    const portfolio = db().prepare(`
      SELECT pp.id, pp.current_cash
      FROM paper_portfolios pp
      JOIN paper_portfolio_wallets ppw ON pp.id = ppw.portfolio_id
      WHERE pp.user_id = ? AND ppw.wallet_address = ? AND pp.is_active = 1
    `).get(userId, sourceWallet.toLowerCase()) as { id: number; current_cash: number } | null;

    if (!portfolio) {
      return { success: false, error: "No active paper portfolio tracking this wallet" };
    }

    const tradePrice = parseFloat(trade.price);
    const tradeSize = parseFloat(trade.size);
    const tradeValue = tradePrice * tradeSize;

    // Scale by copy percentage
    let scaledValue = tradeValue * (copyPercentage / 100);
    let scaledShares = scaledValue / tradePrice;

    // Use asset_id to uniquely identify the outcome (Yes vs No)
    const assetId = trade.asset || trade.conditionId;

    if (trade.side === "BUY") {
      // Check if we have enough cash
      if (portfolio.current_cash < scaledValue) {
        return { success: false, error: "Insufficient paper funds" };
      }

      // Deduct cash
      db().prepare(`
        UPDATE paper_portfolios SET current_cash = current_cash - ?
        WHERE id = ?
      `).run(scaledValue, portfolio.id);

      // Check for existing position - first by asset_id, then legacy by condition_id
      let existingPos = db().prepare(`
        SELECT id, shares, avg_price FROM paper_positions
        WHERE portfolio_id = ? AND asset_id = ?
      `).get(portfolio.id, assetId) as { id: number; shares: number; avg_price: number } | null;

      // Also check for legacy position without asset_id
      if (!existingPos) {
        existingPos = db().prepare(`
          SELECT id, shares, avg_price FROM paper_positions
          WHERE portfolio_id = ? AND condition_id = ? AND (asset_id IS NULL OR asset_id = '')
        `).get(portfolio.id, trade.conditionId) as { id: number; shares: number; avg_price: number } | null;
      }

      if (existingPos) {
        // Update average price and set asset_id for legacy positions
        const totalShares = existingPos.shares + scaledShares;
        const totalCost = (existingPos.shares * existingPos.avg_price) + scaledValue;
        const newAvgPrice = totalCost / totalShares;

        db().prepare(`
          UPDATE paper_positions
          SET shares = ?, avg_price = ?, asset_id = ?
          WHERE id = ?
        `).run(totalShares, newAvgPrice, assetId, existingPos.id);
      } else {
        // Fetch market end date for new positions
        let endDate: number | null = null;
        try {
          const market = await getMarket(trade.conditionId);
          if (market?.endDate) {
            endDate = Math.floor(new Date(market.endDate).getTime() / 1000);
          }
        } catch (e) {
          logger.debug(`Could not fetch market end date for ${trade.conditionId}`);
        }

        db().prepare(`
          INSERT INTO paper_positions (portfolio_id, condition_id, asset_id, source_wallet, market_title, outcome, shares, avg_price, end_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(portfolio.id, trade.conditionId, assetId, sourceWallet.toLowerCase(), trade.title, trade.outcome, scaledShares, tradePrice, endDate);
      }
    } else {
      // SELL - check if we have position (check both asset_id and legacy)
      let existingPos = db().prepare(`
        SELECT id, shares FROM paper_positions
        WHERE portfolio_id = ? AND asset_id = ?
      `).get(portfolio.id, assetId) as { id: number; shares: number } | null;

      if (!existingPos) {
        existingPos = db().prepare(`
          SELECT id, shares FROM paper_positions
          WHERE portfolio_id = ? AND condition_id = ? AND (asset_id IS NULL OR asset_id = '')
        `).get(portfolio.id, trade.conditionId) as { id: number; shares: number } | null;
      }

      if (!existingPos || existingPos.shares <= 0) {
        return { success: false, error: "No position to sell" };
      }

      // Sell whatever we have, up to the scaled amount
      // This handles cases where whale sells more than we have
      const sharesToSell = Math.min(scaledShares, existingPos.shares);
      const actualValue = sharesToSell * tradePrice;

      // Add cash
      db().prepare(`
        UPDATE paper_portfolios SET current_cash = current_cash + ?
        WHERE id = ?
      `).run(actualValue, portfolio.id);

      // Reduce position
      const newShares = existingPos.shares - sharesToSell;
      if (newShares <= 0.0001) {
        db().prepare(`
          DELETE FROM paper_positions WHERE id = ?
        `).run(existingPos.id);
      } else {
        db().prepare(`
          UPDATE paper_positions SET shares = ?, asset_id = ?
          WHERE id = ?
        `).run(newShares, assetId, existingPos.id);
      }

      // Update values for logging
      scaledShares = sharesToSell;
      scaledValue = actualValue;
    }

    // Log the trade
    const result = db().prepare(`
      INSERT INTO paper_trades (portfolio_id, source_wallet, condition_id, market_title, outcome, side, shares, price, value)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(portfolio.id, sourceWallet.toLowerCase(), trade.conditionId, trade.title, trade.outcome, trade.side, scaledShares, tradePrice, scaledValue);

    const paperTrade: PaperTrade = {
      id: Number(result.lastInsertRowid),
      portfolioId: portfolio.id,
      sourceWallet: sourceWallet.toLowerCase(),
      conditionId: trade.conditionId,
      marketTitle: trade.title || "",
      outcome: trade.outcome || "",
      side: trade.side as "BUY" | "SELL",
      shares: scaledShares,
      price: tradePrice,
      value: scaledValue,
      timestamp: Math.floor(Date.now() / 1000),
    };

    logger.info(`Paper trade: ${trade.side} $${scaledValue.toFixed(2)} on ${trade.title} (from ${sourceWallet.slice(0, 10)}...)`);

    // Take a snapshot after the trade
    takePortfolioSnapshot(portfolio.id);

    // Get updated portfolio stats for display
    const updatedPortfolio = db().prepare(`
      SELECT starting_balance, current_cash FROM paper_portfolios WHERE id = ?
    `).get(portfolio.id) as { starting_balance: number; current_cash: number };

    const positions = getPortfolioPositions(portfolio.id);
    const positionsValue = positions.reduce((sum, pos) => sum + pos.value, 0);
    const totalValue = updatedPortfolio.current_cash + positionsValue;
    const totalPnl = totalValue - updatedPortfolio.starting_balance;
    const pnl24hData = get24hPnL(portfolio.id, totalValue);

    // Display in console with portfolio stats
    consoleUI.displayPaperTrade({
      side: trade.side as "BUY" | "SELL",
      market: trade.title || "Unknown Market",
      size: scaledValue,
      price: tradePrice,
      sourceWallet,
      portfolioValue: totalValue,
      totalPnl,
      pnl24h: pnl24hData?.pnl ?? null,
    });

    return { success: true, trade: paperTrade };
  } catch (error: any) {
    logger.error("Failed to process paper trade", error);
    return { success: false, error: error.message };
  }
}

/**
 * Get paper trade history for a user's portfolio
 */
export function getPaperTradeHistory(
  userId: number,
  limit: number = 20
): PaperTrade[] {
  const portfolio = db().prepare(`
    SELECT id FROM paper_portfolios
    WHERE user_id = ? AND is_active = 1
  `).get(userId) as { id: number } | null;

  if (!portfolio) return [];

  return db().prepare(`
    SELECT id, portfolio_id as portfolioId, source_wallet as sourceWallet,
           condition_id as conditionId, market_title as marketTitle, outcome,
           side, shares, price, value, created_at as timestamp
    FROM paper_trades
    WHERE portfolio_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(portfolio.id, limit) as PaperTrade[];
}

/**
 * Get users who are paper trading a specific wallet
 */
export function getPaperSubscribers(sourceWallet: string): Array<{ userId: number; portfolioId: number }> {
  initPaperTables();

  return db().prepare(`
    SELECT pp.user_id as userId, pp.id as portfolioId
    FROM paper_portfolios pp
    JOIN paper_portfolio_wallets ppw ON pp.id = ppw.portfolio_id
    WHERE ppw.wallet_address = ? AND pp.is_active = 1
  `).all(sourceWallet.toLowerCase()) as Array<{ userId: number; portfolioId: number }>;
}

/**
 * Process paper trades for all users tracking a wallet
 * Called when a whale trade is detected
 */
export async function processPaperTradesForWallet(
  sourceWallet: string,
  trade: Trade
): Promise<{ processed: number; failed: number }> {
  const subscribers = getPaperSubscribers(sourceWallet);
  let processed = 0;
  let failed = 0;

  for (const sub of subscribers) {
    const result = await processPaperTrade(sub.userId, sourceWallet, trade);
    if (result.success) {
      processed++;
    } else {
      failed++;
      logger.debug(`Paper trade failed for user ${sub.userId}: ${result.error}`);
    }
  }

  return { processed, failed };
}

/**
 * Format portfolio summary for display
 */
export function formatPortfolioSummary(portfolio: PaperPortfolio): string {
  const startDate = new Date(portfolio.startedAt * 1000).toLocaleDateString();
  const pnlSign = portfolio.pnl >= 0 ? "+" : "";
  const pnlEmoji = portfolio.pnl >= 0 ? "📈" : "📉";

  let msg = `${pnlEmoji} *Paper Trading Portfolio*\n\n`;
  msg += `Started: ${startDate}\n`;
  msg += `Starting: $${portfolio.startingBalance.toFixed(2)}\n`;
  msg += `Current: $${portfolio.totalValue.toFixed(2)}\n`;
  msg += `P&L: ${pnlSign}$${portfolio.pnl.toFixed(2)} (${pnlSign}${portfolio.pnlPercent.toFixed(1)}%)\n`;
  msg += `Trades: ${portfolio.trades}\n`;
  msg += `Cash: $${portfolio.currentCash.toFixed(2)}\n`;

  if (portfolio.wallets.length > 0) {
    msg += `\n*Tracked Wallets (${portfolio.wallets.length}):*\n`;
    for (const wallet of portfolio.wallets.slice(0, 5)) {
      msg += `• ${wallet.slice(0, 10)}...${wallet.slice(-6)}\n`;
    }
    if (portfolio.wallets.length > 5) {
      msg += `  ...and ${portfolio.wallets.length - 5} more\n`;
    }
  } else {
    msg += `\n_No wallets tracked yet. Use /paper add <wallet>_\n`;
  }

  if (portfolio.positions.length > 0) {
    msg += `\n*Open Positions (${portfolio.positions.length}):*\n`;
    for (const pos of portfolio.positions.slice(0, 5)) {
      const title = pos.marketTitle.length > 25
        ? pos.marketTitle.slice(0, 25) + "..."
        : pos.marketTitle;
      msg += `• ${title}: $${pos.value.toFixed(0)}\n`;
    }
    if (portfolio.positions.length > 5) {
      msg += `  ...and ${portfolio.positions.length - 5} more\n`;
    }
  }

  return msg;
}

/**
 * Get wallets tracked in a user's paper portfolio
 */
export function getTrackedWallets(userId: number): string[] {
  const portfolio = db().prepare(`
    SELECT id FROM paper_portfolios
    WHERE user_id = ? AND is_active = 1
  `).get(userId) as { id: number } | null;

  if (!portfolio) return [];

  const wallets = db().prepare(`
    SELECT wallet_address FROM paper_portfolio_wallets
    WHERE portfolio_id = ?
  `).all(portfolio.id) as Array<{ wallet_address: string }>;

  return wallets.map(w => w.wallet_address);
}

/**
 * Take a snapshot of portfolio value (call after each trade)
 */
export function takePortfolioSnapshot(portfolioId: number): void {
  try {
    const portfolio = db().prepare(`
      SELECT starting_balance, current_cash FROM paper_portfolios WHERE id = ?
    `).get(portfolioId) as { starting_balance: number; current_cash: number } | null;

    if (!portfolio) return;

    const positions = getPortfolioPositions(portfolioId);
    const positionsValue = positions.reduce((sum, pos) => sum + pos.value, 0);
    const totalValue = portfolio.current_cash + positionsValue;
    const pnl = totalValue - portfolio.starting_balance;

    db().prepare(`
      INSERT INTO paper_snapshots (portfolio_id, total_value, cash, positions_value, pnl)
      VALUES (?, ?, ?, ?, ?)
    `).run(portfolioId, totalValue, portfolio.current_cash, positionsValue, pnl);
  } catch (error) {
    logger.error("Failed to take portfolio snapshot", error);
  }
}

/**
 * Get portfolio value at a specific time ago
 */
export function getPortfolioValueAt(portfolioId: number, hoursAgo: number): number | null {
  const cutoff = Math.floor(Date.now() / 1000) - (hoursAgo * 3600);

  const snapshot = db().prepare(`
    SELECT total_value FROM paper_snapshots
    WHERE portfolio_id = ? AND created_at <= ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(portfolioId, cutoff) as { total_value: number } | null;

  return snapshot?.total_value ?? null;
}

/**
 * Get 24h P&L for a portfolio
 */
export function get24hPnL(portfolioId: number, currentValue: number): { pnl: number; percent: number } | null {
  const value24hAgo = getPortfolioValueAt(portfolioId, 24);

  if (value24hAgo === null) {
    // No snapshot from 24h ago, use starting balance
    const portfolio = db().prepare(`
      SELECT starting_balance, created_at FROM paper_portfolios WHERE id = ?
    `).get(portfolioId) as { starting_balance: number; created_at: number } | null;

    if (!portfolio) return null;

    // If portfolio is less than 24h old, calculate from start
    const ageHours = (Date.now() / 1000 - portfolio.created_at) / 3600;
    if (ageHours < 24) {
      const pnl = currentValue - portfolio.starting_balance;
      return {
        pnl,
        percent: (pnl / portfolio.starting_balance) * 100,
      };
    }

    return null;
  }

  const pnl = currentValue - value24hAgo;
  return {
    pnl,
    percent: (pnl / value24hAgo) * 100,
  };
}

export interface PortfolioSnapshot {
  timestamp: number;
  value: number;
  pnl: number;
}

/**
 * Get historical snapshots for graphing (past N days)
 */
export function getPortfolioHistory(portfolioId: number, days: number = 30): PortfolioSnapshot[] {
  const cutoff = Math.floor(Date.now() / 1000) - (days * 24 * 3600);

  // Get daily snapshots (one per day, latest of each day)
  const snapshots = db().prepare(`
    SELECT
      total_value as value,
      pnl,
      created_at as timestamp,
      date(created_at, 'unixepoch') as day
    FROM paper_snapshots
    WHERE portfolio_id = ? AND created_at >= ?
    GROUP BY day
    ORDER BY created_at ASC
  `).all(portfolioId, cutoff) as Array<{ value: number; pnl: number; timestamp: number }>;

  return snapshots;
}

/**
 * Get all active paper portfolios (for console display)
 */
export function getAllActivePortfolios(): Array<{
  portfolioId: number;
  userId: number;
  totalValue: number;
  pnl: number;
  pnlPercent: number;
  pnl24h: number | null;
  pnl24hPercent: number | null;
  walletCount: number;
  tradeCount: number;
  startedAt: number;
}> {
  initPaperTables();

  const portfolios = db().prepare(`
    SELECT
      pp.id as portfolioId,
      pp.user_id as userId,
      pp.starting_balance,
      pp.current_cash,
      pp.created_at as startedAt,
      (SELECT COUNT(*) FROM paper_portfolio_wallets WHERE portfolio_id = pp.id) as walletCount,
      (SELECT COUNT(*) FROM paper_trades WHERE portfolio_id = pp.id) as tradeCount
    FROM paper_portfolios pp
    WHERE pp.is_active = 1
  `).all() as Array<{
    portfolioId: number;
    userId: number;
    starting_balance: number;
    current_cash: number;
    startedAt: number;
    walletCount: number;
    tradeCount: number;
  }>;

  return portfolios.map(p => {
    const positions = getPortfolioPositions(p.portfolioId);
    const positionsValue = positions.reduce((sum, pos) => sum + pos.value, 0);
    const totalValue = p.current_cash + positionsValue;
    const pnl = totalValue - p.starting_balance;
    const pnlPercent = (pnl / p.starting_balance) * 100;

    const pnl24hData = get24hPnL(p.portfolioId, totalValue);

    return {
      portfolioId: p.portfolioId,
      userId: p.userId,
      totalValue,
      pnl,
      pnlPercent,
      pnl24h: pnl24hData?.pnl ?? null,
      pnl24hPercent: pnl24hData?.percent ?? null,
      walletCount: p.walletCount,
      tradeCount: p.tradeCount,
      startedAt: p.startedAt,
    };
  });
}

/**
 * Backfill end dates for positions that don't have them
 */
export async function backfillEndDates(): Promise<{ updated: number; failed: number }> {
  initPaperTables();

  // Find positions without end dates
  const positions = db().prepare(`
    SELECT id, condition_id FROM paper_positions
    WHERE end_date IS NULL AND shares > 0
  `).all() as Array<{ id: number; condition_id: string }>;

  if (positions.length === 0) {
    return { updated: 0, failed: 0 };
  }

  logger.info(`Backfilling end dates for ${positions.length} positions...`);

  let updated = 0;
  let failed = 0;

  // Group by condition_id to avoid duplicate API calls
  const conditionIds = [...new Set(positions.map(p => p.condition_id))];

  for (const conditionId of conditionIds) {
    try {
      const market = await getMarket(conditionId);
      if (market?.endDate) {
        const endDate = Math.floor(new Date(market.endDate).getTime() / 1000);

        // Update all positions with this condition_id
        const result = db().prepare(`
          UPDATE paper_positions SET end_date = ?
          WHERE condition_id = ? AND end_date IS NULL
        `).run(endDate, conditionId);

        updated += result.changes;
        logger.debug(`Updated end date for condition ${conditionId}: ${market.endDate}`);
      } else {
        failed++;
      }
    } catch (error) {
      failed++;
      logger.debug(`Failed to fetch market for ${conditionId}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  logger.info(`Backfill complete: ${updated} updated, ${failed} failed`);
  return { updated, failed };
}

/**
 * Refresh prices for positions that don't have recent price data
 */
export async function refreshStalePositionPrices(): Promise<{ updated: number; failed: number }> {
  initPaperTables();

  // Get all positions
  const positions = db().prepare(`
    SELECT DISTINCT condition_id, asset_id, outcome, market_title
    FROM paper_positions
    WHERE shares > 0
  `).all() as Array<{
    condition_id: string;
    asset_id: string | null;
    outcome: string;
    market_title: string;
  }>;

  if (positions.length === 0) {
    return { updated: 0, failed: 0 };
  }

  // Filter to only positions without recent price data
  const stalePositions = positions.filter((pos) => {
    const priceKey = pos.asset_id || pos.condition_id;
    return priceService.getPrice(priceKey) === null;
  });

  if (stalePositions.length === 0) {
    logger.debug("No stale positions need price refresh");
    return { updated: 0, failed: 0 };
  }

  logger.info(`Refreshing prices for ${stalePositions.length} stale positions...`);

  return priceService.fetchPricesForPositions(
    stalePositions.map((pos) => ({
      conditionId: pos.condition_id,
      assetId: pos.asset_id || undefined,
      outcome: pos.outcome,
      title: pos.market_title,
    }))
  );
}

/**
 * Check if a market is resolved and get the winning outcome
 */
async function getMarketResolution(conditionId: string): Promise<MarketResolution | null> {
  try {
    const url = `https://clob.polymarket.com/markets/${conditionId}`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      condition_id: string;
      tokens: Array<{ outcome: string; winner: boolean }>;
      closed?: boolean;
      archived?: boolean;
    };

    // Check if market is resolved (archived means fully resolved)
    const isResolved = data.archived === true;

    if (!isResolved) {
      return { resolved: false, winningOutcome: null, outcomes: data.tokens || [] };
    }

    // Find the winning outcome
    const winner = data.tokens?.find(t => t.winner === true);

    return {
      resolved: true,
      winningOutcome: winner?.outcome || null,
      outcomes: data.tokens || [],
    };
  } catch (error) {
    logger.debug(`Failed to check resolution for ${conditionId}`);
    return null;
  }
}

/**
 * Redeem resolved positions at their final value
 * Winners get $1 per share, losers get $0
 */
export async function redeemResolvedPositions(): Promise<{
  redeemed: number;
  totalValue: number;
  positions: Array<{ title: string; outcome: string; won: boolean; value: number }>;
}> {
  initPaperTables();

  // Get all open positions with end dates in the past
  const now = Math.floor(Date.now() / 1000);
  const positions = db().prepare(`
    SELECT
      pp.id,
      pp.portfolio_id,
      pp.condition_id,
      pp.asset_id,
      pp.market_title,
      pp.outcome,
      pp.shares,
      pp.avg_price
    FROM paper_positions pp
    WHERE pp.shares > 0 AND pp.end_date IS NOT NULL AND pp.end_date < ?
  `).all(now) as Array<{
    id: number;
    portfolio_id: number;
    condition_id: string;
    asset_id: string | null;
    market_title: string;
    outcome: string;
    shares: number;
    avg_price: number;
  }>;

  if (positions.length === 0) {
    return { redeemed: 0, totalValue: 0, positions: [] };
  }

  logger.info(`Checking ${positions.length} ended positions for redemption...`);

  let redeemed = 0;
  let totalValue = 0;
  const redeemedPositions: Array<{ title: string; outcome: string; won: boolean; value: number }> = [];

  // Group by condition_id to minimize API calls
  const byCondition = new Map<string, typeof positions>();
  for (const pos of positions) {
    const existing = byCondition.get(pos.condition_id) || [];
    existing.push(pos);
    byCondition.set(pos.condition_id, existing);
  }

  for (const [conditionId, conditionPositions] of byCondition) {
    const resolution = await getMarketResolution(conditionId);

    if (!resolution || !resolution.resolved) {
      // Market not resolved yet, skip
      continue;
    }

    for (const pos of conditionPositions) {
      // Determine if this position won
      const won = pos.outcome.toLowerCase() === resolution.winningOutcome?.toLowerCase();
      const redemptionPrice = won ? 1.0 : 0.0;
      const redemptionValue = pos.shares * redemptionPrice;

      // Add cash to portfolio
      db().prepare(`
        UPDATE paper_portfolios SET current_cash = current_cash + ?
        WHERE id = ?
      `).run(redemptionValue, pos.portfolio_id);

      // Record the redemption as a trade
      db().prepare(`
        INSERT INTO paper_trades (portfolio_id, source_wallet, condition_id, market_title, outcome, side, shares, price, value)
        VALUES (?, 'REDEMPTION', ?, ?, ?, 'REDEEM', ?, ?, ?)
      `).run(
        pos.portfolio_id,
        pos.condition_id,
        pos.market_title,
        pos.outcome,
        pos.shares,
        redemptionPrice,
        redemptionValue
      );

      // Delete the position
      db().prepare(`DELETE FROM paper_positions WHERE id = ?`).run(pos.id);

      // Take a snapshot
      takePortfolioSnapshot(pos.portfolio_id);

      redeemed++;
      totalValue += redemptionValue;
      redeemedPositions.push({
        title: pos.market_title || "Unknown",
        outcome: pos.outcome,
        won,
        value: redemptionValue,
      });

      const wonText = won ? "WON" : "LOST";
      const valueText = redemptionValue > 0 ? `+$${redemptionValue.toFixed(2)}` : "$0.00";
      logger.info(`Redeemed: ${pos.market_title?.slice(0, 40)}... [${pos.outcome}] - ${wonText} ${valueText}`);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (redeemed > 0) {
    logger.success(`Redeemed ${redeemed} resolved positions for $${totalValue.toFixed(2)}`);
  }

  return { redeemed, totalValue, positions: redeemedPositions };
}

/**
 * Initialize paper trading and backfill missing data
 * Call this on startup to ensure data is up to date
 */
export async function initAndBackfill(): Promise<void> {
  initPaperTables();

  // Backfill end dates for positions missing them
  const endDateResult = await backfillEndDates();
  if (endDateResult.updated > 0) {
    logger.info(`Backfilled ${endDateResult.updated} position end dates`);
  }

  // Refresh prices for stale positions
  const priceResult = await refreshStalePositionPrices();
  if (priceResult.updated > 0) {
    logger.info(`Refreshed ${priceResult.updated} position prices`);
  }

  // Redeem any resolved positions
  const redeemResult = await redeemResolvedPositions();
  if (redeemResult.redeemed > 0) {
    logger.success(`Auto-redeemed ${redeemResult.redeemed} positions for $${redeemResult.totalValue.toFixed(2)}`);
  }
}

// Interval handle for redemption monitor
let redemptionInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic redemption checking (every 5 minutes)
 */
export function startRedemptionMonitor(intervalMs: number = 5 * 60 * 1000): void {
  if (redemptionInterval) {
    return; // Already running
  }

  logger.info(`Starting redemption monitor (checking every ${intervalMs / 1000}s)`);

  redemptionInterval = setInterval(async () => {
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
      logger.error("Redemption check failed", error);
    }
  }, intervalMs);
}

/**
 * Stop redemption monitor
 */
export function stopRedemptionMonitor(): void {
  if (redemptionInterval) {
    clearInterval(redemptionInterval);
    redemptionInterval = null;
    logger.info("Redemption monitor stopped");
  }
}
