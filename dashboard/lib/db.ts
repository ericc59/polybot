import Database from 'better-sqlite3';
import path from 'path';

// Connect to the bot's SQLite database (read-only)
const dbPath = path.join(process.cwd(), '..', 'data', 'polybot.db');
const db = new Database(dbPath, { readonly: true });

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');

// Types
export interface Wallet {
  address: string;
  total_pnl: number;
  win_rate: number;
  total_trades: number;
  avg_trade_size: number;
  whale_type: string;
  last_trade_at: number;
  pnl_per_trade: number;
  trade_frequency: number;
  category_pnl: string | null;
  cached_at: number;
  subscriber_count?: number;
}

export interface User {
  id: number;
  telegram_id: string;
  telegram_username: string | null;
  subscription_tier: string;
  created_at: number;
  last_active_at: number;
  is_active: number;
}

export interface Alert {
  id: number;
  wallet_address: string;
  market_title: string;
  trade_side: string;
  trade_size: number;
  trade_price: number;
  sent_at: number;
}

export interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalWalletsTracked: number;
  uniqueWalletsTracked: number;
  alertsToday: number;
  subscriptionBreakdown: {
    free: number;
    pro: number;
    enterprise: number;
  };
}

// Get system stats
export function getStats(): Stats {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  const activeUsers = db.prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1 AND is_banned = 0').get() as { count: number };
  const totalWalletsTracked = db.prepare('SELECT COUNT(*) as count FROM user_wallets').get() as { count: number };
  const uniqueWalletsTracked = db.prepare('SELECT COUNT(DISTINCT wallet_address) as count FROM user_wallets').get() as { count: number };

  const todayStart = Math.floor(Date.now() / 1000) - 86400;
  const alertsToday = db.prepare('SELECT COUNT(*) as count FROM alert_history WHERE sent_at > ?').get(todayStart) as { count: number };

  const freeUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE subscription_tier = 'free'").get() as { count: number };
  const proUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE subscription_tier = 'pro'").get() as { count: number };
  const enterpriseUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE subscription_tier = 'enterprise'").get() as { count: number };

  return {
    totalUsers: totalUsers.count,
    activeUsers: activeUsers.count,
    totalWalletsTracked: totalWalletsTracked.count,
    uniqueWalletsTracked: uniqueWalletsTracked.count,
    alertsToday: alertsToday.count,
    subscriptionBreakdown: {
      free: freeUsers.count,
      pro: proUsers.count,
      enterprise: enterpriseUsers.count,
    },
  };
}

// Get all tracked wallets with subscriber counts
export function getWallets(limit = 100, offset = 0): Wallet[] {
  const wallets = db.prepare(`
    SELECT
      wc.*,
      COUNT(uw.id) as subscriber_count
    FROM wallet_cache wc
    LEFT JOIN user_wallets uw ON wc.address = uw.wallet_address
    GROUP BY wc.address
    ORDER BY wc.total_pnl DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as Wallet[];

  return wallets;
}

// Get total wallet count
export function getWalletCount(): number {
  const result = db.prepare('SELECT COUNT(*) as count FROM wallet_cache').get() as { count: number };
  return result.count;
}

// Get single wallet details
export function getWallet(address: string): Wallet | null {
  const wallet = db.prepare(`
    SELECT
      wc.*,
      COUNT(uw.id) as subscriber_count
    FROM wallet_cache wc
    LEFT JOIN user_wallets uw ON wc.address = uw.wallet_address
    WHERE wc.address = ?
    GROUP BY wc.address
  `).get(address) as Wallet | null;

  return wallet;
}

// Get recent alerts (as proxy for trades)
export function getRecentTrades(limit = 50): Alert[] {
  const alerts = db.prepare(`
    SELECT
      id,
      wallet_address,
      market_title,
      trade_side,
      trade_size,
      trade_price,
      sent_at
    FROM alert_history
    ORDER BY sent_at DESC
    LIMIT ?
  `).all(limit) as Alert[];

  return alerts;
}

// Get trades for a specific wallet
export function getWalletTrades(address: string, limit = 50): Alert[] {
  const alerts = db.prepare(`
    SELECT
      id,
      wallet_address,
      market_title,
      trade_side,
      trade_size,
      trade_price,
      sent_at
    FROM alert_history
    WHERE wallet_address = ?
    ORDER BY sent_at DESC
    LIMIT ?
  `).all(address, limit) as Alert[];

  return alerts;
}

// Get top performing wallets (only profitable ones)
export function getTopWallets(limit = 10): Wallet[] {
  const wallets = db.prepare(`
    SELECT
      wc.*,
      COUNT(uw.id) as subscriber_count
    FROM wallet_cache wc
    LEFT JOIN user_wallets uw ON wc.address = uw.wallet_address
    WHERE wc.total_pnl > 0
    GROUP BY wc.address
    ORDER BY wc.total_pnl DESC
    LIMIT ?
  `).all(limit) as Wallet[];

  return wallets;
}

// =============================================
// COPY TRADING DATA
// =============================================

export interface CopyTrade {
  id: number;
  userId: number;
  sourceWallet: string;
  marketTitle: string;
  side: string;
  size: number;
  price: number;
  status: string;
  createdAt: number;
  executedAt: number | null;
}

export interface CopyTradingStats {
  totalTrades: number;
  executedTrades: number;
  failedTrades: number;
  totalVolume: number;
  todayVolume: number;
  todayTrades: number;
}

export interface TradingAccount {
  walletAddress: string;
  proxyAddress: string | null;
  copyEnabled: boolean;
  copyPercentage: number;
  maxTradeSize: number | null;
  dailyLimit: number | null;
}

// Get recent copy trades
export function getCopyTrades(limit = 50): CopyTrade[] {
  const trades = db.prepare(`
    SELECT
      id,
      user_id as userId,
      source_wallet as sourceWallet,
      market_title as marketTitle,
      side,
      size,
      price,
      status,
      created_at as createdAt,
      executed_at as executedAt
    FROM copy_trade_history
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as CopyTrade[];

  return trades;
}

// Get copy trading stats
export function getCopyTradingStats(): CopyTradingStats {
  const total = db.prepare('SELECT COUNT(*) as count FROM copy_trade_history').get() as { count: number };
  const executed = db.prepare("SELECT COUNT(*) as count FROM copy_trade_history WHERE status = 'executed'").get() as { count: number };
  const failed = db.prepare("SELECT COUNT(*) as count FROM copy_trade_history WHERE status = 'failed'").get() as { count: number };

  const volumeResult = db.prepare(`
    SELECT COALESCE(SUM(size * price), 0) as volume
    FROM copy_trade_history
    WHERE status = 'executed'
  `).get() as { volume: number };

  const todayStart = Math.floor(Date.now() / 1000) - 86400;
  const todayVolumeResult = db.prepare(`
    SELECT COALESCE(SUM(size * price), 0) as volume, COUNT(*) as count
    FROM copy_trade_history
    WHERE status = 'executed' AND created_at > ?
  `).get(todayStart) as { volume: number; count: number };

  return {
    totalTrades: total.count,
    executedTrades: executed.count,
    failedTrades: failed.count,
    totalVolume: volumeResult.volume,
    todayVolume: todayVolumeResult.volume,
    todayTrades: todayVolumeResult.count,
  };
}

// Get trading account info
export function getTradingAccount(): TradingAccount | null {
  const account = db.prepare(`
    SELECT
      wallet_address as walletAddress,
      proxy_address as proxyAddress,
      copy_enabled as copyEnabled,
      copy_percentage as copyPercentage,
      max_trade_size as maxTradeSize,
      daily_limit as dailyLimit
    FROM user_trading_wallets
    LIMIT 1
  `).get() as TradingAccount | null;

  return account;
}

// =============================================
// TENNIS BOT DATA
// =============================================

// Connect to tennis bot's SQLite database (read-only)
const tennisDbPath = path.join(process.cwd(), '..', 'data', 'tennis.db');
let tennisDb: Database.Database | null = null;

function getTennisDb(): Database.Database {
  if (!tennisDb) {
    try {
      tennisDb = new Database(tennisDbPath, { readonly: true });
      tennisDb.pragma('journal_mode = WAL');
    } catch (error) {
      console.error('Failed to connect to tennis database:', error);
      throw error;
    }
  }
  return tennisDb;
}

export interface TennisMatch {
  id: number;
  oddsApiId: string;
  player1: string;
  player2: string;
  commenceTime: number;
  sportKey: string;
  polymarketConditionId: string | null;
  polymarketSlug: string | null;
  player1TokenId: string | null;
  player2TokenId: string | null;
  status: string;
  walkoverDetectedAt: number | null;
  ordersPlacedAt: number | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TennisTrade {
  id: number;
  matchId: number;
  player1: string;
  player2: string;
  side: string;
  shares: number;
  price: number;
  cost: number;
  profit: number | null;
  status: string;
  orderId: string | null;
  createdAt: number;
}

export interface TennisStats {
  trackedMatches: number;
  todayMatches: number;
  walkoversDetected: number;
  totalTrades: number;
  totalProfit: number;
  winRate: number;
  botStatus: 'running' | 'stopped' | 'error';
}

// Get tennis stats
export function getTennisStats(): TennisStats {
  try {
    const db = getTennisDb();

    const trackedMatches = db.prepare(
      "SELECT COUNT(*) as count FROM tracked_matches WHERE status NOT IN ('completed', 'ignored')"
    ).get() as { count: number };

    const todayStart = Math.floor(Date.now() / 1000);
    const todayEnd = todayStart + 86400;
    const todayMatches = db.prepare(
      "SELECT COUNT(*) as count FROM tracked_matches WHERE commence_time >= ? AND commence_time < ? AND status NOT IN ('completed', 'ignored')"
    ).get(todayStart - 86400, todayEnd) as { count: number };

    const walkoversDetected = db.prepare(
      'SELECT COUNT(*) as count FROM tracked_matches WHERE walkover_detected_at IS NOT NULL'
    ).get() as { count: number };

    // Check if trade_history table exists
    let totalTrades = 0;
    let totalProfit = 0;
    try {
      const tradesResult = db.prepare('SELECT COUNT(*) as count FROM trade_history').get() as { count: number };
      totalTrades = tradesResult.count;

      const profitResult = db.prepare('SELECT COALESCE(SUM(profit), 0) as profit FROM trade_history').get() as { profit: number };
      totalProfit = profitResult.profit;
    } catch {
      // Table doesn't exist yet
    }

    return {
      trackedMatches: trackedMatches.count,
      todayMatches: todayMatches.count,
      walkoversDetected: walkoversDetected.count,
      totalTrades,
      totalProfit,
      winRate: 0, // Calculate when we have trades
      botStatus: 'running', // Would need to check process status
    };
  } catch (error) {
    console.error('Error fetching tennis stats:', error);
    return {
      trackedMatches: 0,
      todayMatches: 0,
      walkoversDetected: 0,
      totalTrades: 0,
      totalProfit: 0,
      winRate: 0,
      botStatus: 'error',
    };
  }
}

// Get tennis matches
export function getTennisMatches(limit = 50): TennisMatch[] {
  try {
    const db = getTennisDb();

    const matches = db.prepare(`
      SELECT
        id,
        odds_api_id as oddsApiId,
        player1,
        player2,
        commence_time as commenceTime,
        sport_key as sportKey,
        polymarket_condition_id as polymarketConditionId,
        polymarket_slug as polymarketSlug,
        player1_token_id as player1TokenId,
        player2_token_id as player2TokenId,
        status,
        walkover_detected_at as walkoverDetectedAt,
        orders_placed_at as ordersPlacedAt,
        notes,
        created_at as createdAt,
        updated_at as updatedAt
      FROM tracked_matches
      WHERE status NOT IN ('completed', 'ignored')
      ORDER BY commence_time ASC
      LIMIT ?
    `).all(limit) as TennisMatch[];

    return matches;
  } catch (error) {
    console.error('Error fetching tennis matches:', error);
    return [];
  }
}

// Get tennis trades
export function getTennisTrades(limit = 50): TennisTrade[] {
  try {
    const db = getTennisDb();

    // Check if table exists first
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='trade_history'
    `).get();

    if (!tableExists) {
      return [];
    }

    const trades = db.prepare(`
      SELECT
        th.id,
        th.match_id as matchId,
        tm.player1,
        tm.player2,
        th.side,
        th.shares,
        th.price,
        th.cost,
        th.profit,
        th.status,
        th.order_id as orderId,
        th.created_at as createdAt
      FROM trade_history th
      LEFT JOIN tracked_matches tm ON th.match_id = tm.id
      ORDER BY th.created_at DESC
      LIMIT ?
    `).all(limit) as TennisTrade[];

    return trades;
  } catch (error) {
    console.error('Error fetching tennis trades:', error);
    return [];
  }
}

export default db;
